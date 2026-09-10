import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.SCHEMAFORGE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-test-'));

const { openMemoryDb } = await import('../store/db.js');
openMemoryDb();
const { ensureSampleDatabase } = await import('../seed.js');
const { workspaces, projects, connections, agents, tasks, approvals, artifacts, events } = await import('../store/repos.js');
const { runtime, createAndStartTask } = await import('../agents/runtime.js');
const { closeAll } = await import('../dbs/manager.js');

const ws = workspaces.create('test');
const project = projects.create({ workspaceId: ws.id, name: 'p', rootPath: null });
const conn = connections.create({ projectId: project.id, name: 'sample', engine: 'sqlite', database: 'sample', filePath: ensureSampleDatabase() });

async function waitFor(pred: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 25));
  }
}

before(() => runtime.init());
after(async () => { await closeAll(); });

test('heuristic agent completes a schema review and produces an artifact', async () => {
  const agent = agents.create({ workspaceId: ws.id, name: 'DB', role: 'database engineer', provider: 'heuristic', model: 'heuristic-v1' });
  const t = createAndStartTask({ projectId: project.id, connectionId: conn.id, title: 'Review the sip mandates schema', agentId: agent.id, start: true });
  await waitFor(() => ['COMPLETED', 'FAILED'].includes(tasks.get(t.id)!.status));
  const done = tasks.get(t.id)!;
  assert.equal(done.status, 'COMPLETED', done.error ?? '');
  assert.match(done.result ?? '', /sip_mandates/);
  assert.ok(artifacts.list({ taskId: t.id }).some((a) => a.type === 'analysis'));
  const types = events.list({ taskId: t.id, limit: 100 }).map((e) => e.type);
  assert.ok(types.includes('tool.call') && types.includes('tool.result') && types.includes('task.completed'));
  assert.equal(agents.get(agent.id)!.status, 'COMPLETED');
});

test('write SQL waits for approval and executes after approval', async () => {
  const agent = agents.create({ workspaceId: ws.id, name: 'Mig', role: 'migration', provider: 'heuristic', model: 'heuristic-v1', permissions: { sql: { safe: 'allow', write: 'ask', ddl: 'ask', destructive: 'deny' } } });
  const t = createAndStartTask({ projectId: project.id, connectionId: conn.id, title: 'Execute the selected SQL', agentId: agent.id, context: { sql: "INSERT INTO audit_log (actor, action, entity) VALUES ('test','X','y')" }, start: true });
  await waitFor(() => tasks.get(t.id)!.status === 'WAITING_FOR_APPROVAL');
  const pending = approvals.list({ taskId: t.id, status: 'pending' });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].toolName, 'run_sql');
  assert.equal(agents.get(agent.id)!.status, 'WAITING_FOR_APPROVAL');
  runtime.resolveApproval(pending[0].id, true, 'go');
  await waitFor(() => ['COMPLETED', 'FAILED'].includes(tasks.get(t.id)!.status));
  assert.equal(tasks.get(t.id)!.status, 'COMPLETED');
  assert.match(tasks.get(t.id)!.result ?? '', /Affected rows: 1/);
  assert.equal(approvals.get(pending[0].id)!.status, 'approved');
});

test('rejected approval leads to a graceful completion without execution', async () => {
  const agent = agents.create({ workspaceId: ws.id, name: 'Mig2', role: 'migration', provider: 'heuristic', model: 'heuristic-v1' });
  const t = createAndStartTask({ projectId: project.id, connectionId: conn.id, title: 'Run the selected SQL', agentId: agent.id, context: { sql: "INSERT INTO audit_log (actor, action, entity) VALUES ('test','Y','z')" }, start: true });
  await waitFor(() => tasks.get(t.id)!.status === 'WAITING_FOR_APPROVAL');
  const pending = approvals.list({ taskId: t.id, status: 'pending' })[0];
  runtime.resolveApproval(pending.id, false, 'not now');
  await waitFor(() => ['COMPLETED', 'FAILED'].includes(tasks.get(t.id)!.status));
  assert.equal(tasks.get(t.id)!.status, 'COMPLETED');
  assert.match(tasks.get(t.id)!.result ?? '', /not executed/);
});

test('destructive SQL is denied by policy without asking', async () => {
  const agent = agents.create({ workspaceId: ws.id, name: 'Mig3', role: 'migration', provider: 'heuristic', model: 'heuristic-v1' });
  const t = createAndStartTask({ projectId: project.id, connectionId: conn.id, title: 'Execute the selected SQL', agentId: agent.id, context: { sql: 'DELETE FROM audit_log' }, start: true });
  await waitFor(() => ['COMPLETED', 'FAILED'].includes(tasks.get(t.id)!.status));
  assert.equal(approvals.list({ taskId: t.id }).length, 0);
  assert.match(tasks.get(t.id)!.result ?? '', /Permission denied/);
  assert.ok(events.list({ taskId: t.id, limit: 100 }).some((e) => e.type === 'tool.result' && e.data?.denied === true));
});

test('task dependencies run in order', async () => {
  const a1 = agents.create({ workspaceId: ws.id, name: 'A1', role: 'database engineer', provider: 'heuristic', model: 'heuristic-v1' });
  const a2 = agents.create({ workspaceId: ws.id, name: 'A2', role: 'reviewer', provider: 'heuristic', model: 'heuristic-v1' });
  const up = createAndStartTask({ projectId: project.id, connectionId: conn.id, title: 'Review the funds schema', agentId: a1.id, start: true });
  const down = createAndStartTask({ projectId: project.id, connectionId: conn.id, title: 'Review the folios schema', agentId: a2.id, dependsOn: [up.id], start: true });
  await waitFor(() => tasks.get(down.id)!.status === 'COMPLETED', 8000);
  assert.equal(tasks.get(up.id)!.status, 'COMPLETED');
  assert.ok(tasks.get(up.id)!.completedAt! <= tasks.get(down.id)!.startedAt!);
});

test('stop cancels a queued task', () => {
  const agent = agents.create({ workspaceId: ws.id, name: 'Q', role: 'x', provider: 'heuristic', model: 'heuristic-v1' });
  agents.setStatus(agent.id, 'RUNNING', 'busy', null, null); // simulate a busy agent so the task stays queued
  const t = createAndStartTask({ projectId: project.id, connectionId: conn.id, title: 'Review the customers schema', agentId: agent.id, start: true });
  assert.equal(tasks.get(t.id)!.status, 'QUEUED');
  runtime.stop(t.id);
  assert.equal(tasks.get(t.id)!.status, 'CANCELLED');
});
