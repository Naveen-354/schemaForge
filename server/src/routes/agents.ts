import { Hono } from 'hono';
import type { AgentInput, TaskInput } from '@schemaforge/shared';
import { agents, approvals, artifacts, knowledge, projects, runMessages, runs, tasks, workspaces } from '../store/repos.js';
import { createAndStartTask, runtime } from '../agents/runtime.js';
import { bus } from '../events.js';
import { TOOLS } from '../agents/tools.js';
import { defaultProviderId, getProvider } from '../ai/providers/index.js';
import { searchKnowledge } from '../agents/knowledge.js';

export const agentRoutes = new Hono();

// ---------- agents ----------
agentRoutes.get('/agents', (c) => c.json(agents.list({ workspaceId: c.req.query('workspaceId'), projectId: c.req.query('projectId') })));
agentRoutes.get('/agents/tools', (c) => c.json(TOOLS.map((t) => ({ name: t.name, description: t.description, risk: t.risk }))));
agentRoutes.get('/agents/:id', (c) => {
  const a = agents.get(c.req.param('id'));
  return a ? c.json(a) : c.json({ error: 'Not found' }, 404);
});
agentRoutes.post('/agents', async (c) => {
  const body = await c.req.json<AgentInput>();
  const workspaceId = body.workspaceId ?? workspaces.list()[0]?.id;
  if (!workspaceId) return c.json({ error: 'No workspace' }, 400);
  const provider = body.provider ?? defaultProviderId();
  const a = agents.create({ ...body, workspaceId, provider, model: body.model ?? getProvider(provider).defaultModel });
  bus.emitEvent({ type: 'agent.created', message: `Agent created: ${a.name} (${a.role})`, workspaceId, projectId: a.projectId, agentId: a.id });
  bus.notify('agent', a.id, a.projectId);
  return c.json(a, 201);
});
agentRoutes.patch('/agents/:id', async (c) => {
  const a = agents.update(c.req.param('id'), await c.req.json());
  if (!a) return c.json({ error: 'Not found' }, 404);
  bus.emitEvent({ type: 'agent.updated', message: `Agent updated: ${a.name}`, workspaceId: a.workspaceId, projectId: a.projectId, agentId: a.id });
  bus.notify('agent', a.id, a.projectId);
  return c.json(a);
});
agentRoutes.delete('/agents/:id', (c) => {
  const a = agents.get(c.req.param('id'));
  if (a && ['RUNNING', 'WAITING_FOR_APPROVAL', 'PAUSED'].includes(a.status)) return c.json({ error: 'Agent is busy; stop its task first' }, 409);
  agents.delete(c.req.param('id'));
  return c.json({ ok: true });
});
agentRoutes.post('/agents/:id/reset', (c) => {
  const a = agents.get(c.req.param('id'));
  if (!a) return c.json({ error: 'Not found' }, 404);
  if (['RUNNING', 'WAITING_FOR_APPROVAL', 'PAUSED'].includes(a.status)) return c.json({ error: 'Agent is busy' }, 409);
  const u = agents.setStatus(a.id, 'IDLE', null, null, null)!;
  bus.notify('agent', a.id, a.projectId);
  return c.json(u);
});
agentRoutes.get('/agents/:id/runs', (c) => c.json(runs.list({ agentId: c.req.param('id'), limit: 50 })));

// ---------- tasks ----------
agentRoutes.get('/tasks', (c) => c.json(tasks.list({ projectId: c.req.query('projectId'), agentId: c.req.query('agentId'), status: c.req.query('status') as never })));
agentRoutes.get('/tasks/:id', (c) => {
  const t = tasks.get(c.req.param('id'));
  return t ? c.json(t) : c.json({ error: 'Not found' }, 404);
});
agentRoutes.post('/tasks', async (c) => {
  const body = await c.req.json<TaskInput>();
  if (!projects.get(body.projectId)) return c.json({ error: 'Project not found' }, 400);
  return c.json(createAndStartTask(body), 201);
});
agentRoutes.patch('/tasks/:id', async (c) => {
  const t = tasks.update(c.req.param('id'), await c.req.json());
  if (!t) return c.json({ error: 'Not found' }, 404);
  bus.notify('task', t.id, t.projectId);
  return c.json(t);
});
agentRoutes.delete('/tasks/:id', (c) => {
  const t = tasks.get(c.req.param('id'));
  if (t && ['RUNNING', 'WAITING_FOR_APPROVAL', 'PAUSED'].includes(t.status)) runtime.stop(t.id);
  tasks.delete(c.req.param('id'));
  return c.json({ ok: true });
});
agentRoutes.post('/tasks/:id/start', (c) => c.json(runtime.enqueue(c.req.param('id'))));
agentRoutes.post('/tasks/:id/stop', (c) => c.json(runtime.stop(c.req.param('id'))));
agentRoutes.post('/tasks/:id/cancel', (c) => c.json(runtime.cancel(c.req.param('id'))));
agentRoutes.post('/tasks/:id/pause', (c) => c.json(runtime.pause(c.req.param('id'))));
agentRoutes.post('/tasks/:id/resume', (c) => c.json(runtime.resume(c.req.param('id'))));
agentRoutes.post('/tasks/:id/retry', async (c) => {
  const body = await c.req.json<{ agentId?: string }>().catch(() => ({} as { agentId?: string }));
  return c.json(runtime.retry(c.req.param('id'), body.agentId));
});
agentRoutes.get('/tasks/:id/runs', (c) => c.json(runs.list({ taskId: c.req.param('id') })));
agentRoutes.get('/tasks/:id/artifacts', (c) => c.json(artifacts.list({ taskId: c.req.param('id') })));

/** Chat-style entry point: a question becomes a task for an assistant agent. */
agentRoutes.post('/ask', async (c) => {
  const body = await c.req.json<{ projectId: string; question: string; agentId?: string; connectionId?: string | null; context?: TaskInput['context'] }>();
  const project = projects.get(body.projectId);
  if (!project) return c.json({ error: 'Project not found' }, 400);
  let agentId = body.agentId;
  if (!agentId) {
    const list = agents.list({ projectId: project.id });
    agentId = (list.find((a) => /assistant/i.test(a.role) || /assistant/i.test(a.name)) ?? list[0])?.id;
  }
  if (!agentId) return c.json({ error: 'No agent available; create one first' }, 400);
  const t = createAndStartTask({
    projectId: project.id, connectionId: body.connectionId ?? null, title: body.question, description: '', agentId,
    priority: 'high', context: { ...(body.context ?? {}), kind: 'chat' }, start: true,
  });
  return c.json(t, 201);
});

// ---------- runs ----------
agentRoutes.get('/runs', (c) => c.json(runs.list({ projectId: c.req.query('projectId'), limit: Number(c.req.query('limit') ?? 100) })));
agentRoutes.get('/runs/:id', (c) => {
  const r = runs.get(c.req.param('id'));
  return r ? c.json({ ...r, messages: runMessages.list(r.id) }) : c.json({ error: 'Not found' }, 404);
});

// ---------- approvals ----------
agentRoutes.get('/approvals', (c) => c.json(approvals.list({ projectId: c.req.query('projectId'), status: c.req.query('status'), taskId: c.req.query('taskId') })));
agentRoutes.post('/approvals/:id/approve', async (c) => {
  const body = await c.req.json<{ note?: string }>().catch(() => ({} as { note?: string }));
  return c.json(runtime.resolveApproval(c.req.param('id'), true, body.note));
});
agentRoutes.post('/approvals/:id/reject', async (c) => {
  const body = await c.req.json<{ note?: string }>().catch(() => ({} as { note?: string }));
  return c.json(runtime.resolveApproval(c.req.param('id'), false, body.note));
});

// ---------- artifacts ----------
agentRoutes.get('/artifacts', (c) => c.json(artifacts.list({ projectId: c.req.query('projectId'), taskId: c.req.query('taskId'), agentId: c.req.query('agentId'), type: c.req.query('type'), limit: Number(c.req.query('limit') ?? 200) })));
agentRoutes.get('/artifacts/:id', (c) => {
  const a = artifacts.get(c.req.param('id'));
  return a ? c.json(a) : c.json({ error: 'Not found' }, 404);
});
agentRoutes.post('/artifacts', async (c) => {
  const body = await c.req.json();
  const a = artifacts.create({ taskId: null, agentId: null, runId: null, language: null, metadata: {}, ...body });
  const project = projects.get(a.projectId);
  bus.emitEvent({ type: 'artifact.created', message: `Artifact created: ${a.title} [${a.type}]`, workspaceId: project?.workspaceId ?? '', projectId: a.projectId, data: { artifactId: a.id } });
  bus.notify('artifact', a.id, a.projectId);
  return c.json(a, 201);
});
agentRoutes.delete('/artifacts/:id', (c) => { artifacts.delete(c.req.param('id')); return c.json({ ok: true }); });

// ---------- knowledge ----------
agentRoutes.get('/knowledge', (c) => {
  const q = c.req.query('q');
  const projectId = c.req.query('projectId');
  if (q && projectId) return c.json(searchKnowledge(projectId, q, Number(c.req.query('limit') ?? 20)));
  return c.json(knowledge.list({ projectId, scope: c.req.query('scope'), agentId: c.req.query('agentId') }));
});
agentRoutes.post('/knowledge', async (c) => {
  const body = await c.req.json();
  const k = knowledge.create({ scope: 'project', agentId: null, tags: [], ...body });
  const project = k.projectId ? projects.get(k.projectId) : null;
  bus.emitEvent({ type: 'knowledge.saved', message: `Knowledge saved: ${k.title}`, workspaceId: project?.workspaceId ?? workspaces.list()[0]?.id ?? '', projectId: k.projectId, data: { knowledgeId: k.id } });
  bus.notify('knowledge', k.id, k.projectId);
  return c.json(k, 201);
});
agentRoutes.patch('/knowledge/:id', async (c) => {
  const k = knowledge.update(c.req.param('id'), await c.req.json());
  if (k) bus.notify('knowledge', k.id, k.projectId);
  return c.json(k);
});
agentRoutes.delete('/knowledge/:id', (c) => { knowledge.delete(c.req.param('id')); return c.json({ ok: true }); });
