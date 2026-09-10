import { Hono } from 'hono';
import type { ConnectionInput } from '@schemaforge/shared';
import { tableKey } from '@schemaforge/shared';
import { connections, layouts, projects, queryHistory, savedQueries, workspaces } from '../store/repos.js';
import { dropAdapter, executeSql, explainSql, findTable, getSnapshot, refreshSnapshot, testConnection } from '../dbs/manager.js';
import { classifySql, referencedTables } from '../sql/classify.js';
import { generateTableDdl } from '../sql/ddl.js';
import { lintTables } from '../sql/lint.js';
import { bus } from '../events.js';
import { getPolicy, setPolicy } from '../agents/permissions.js';

export const core = new Hono();

// ---------- workspaces ----------
core.get('/workspaces', (c) => c.json(workspaces.list()));
core.post('/workspaces', async (c) => {
  const body = await c.req.json<{ name: string }>();
  return c.json(workspaces.create(body.name), 201);
});
core.patch('/workspaces/:id', async (c) => {
  const body = await c.req.json<{ name: string }>();
  return c.json(workspaces.rename(c.req.param('id'), body.name));
});
core.get('/workspaces/:id/policy', (c) => c.json(getPolicy('workspace', c.req.param('id'))));
core.put('/workspaces/:id/policy', async (c) => { setPolicy('workspace', c.req.param('id'), await c.req.json()); return c.json({ ok: true }); });

// ---------- projects ----------
core.get('/projects', (c) => c.json(projects.list(c.req.query('workspaceId'))));
core.get('/projects/:id', (c) => {
  const p = projects.get(c.req.param('id'));
  return p ? c.json(p) : c.json({ error: 'Not found' }, 404);
});
core.post('/projects', async (c) => {
  const body = await c.req.json<{ workspaceId: string; name: string; description?: string; rootPath?: string | null; instructions?: string }>();
  const p = projects.create(body);
  bus.emitEvent({ type: 'project.updated', message: `Project created: ${p.name}`, workspaceId: p.workspaceId, projectId: p.id });
  bus.notify('project', p.id, p.id);
  return c.json(p, 201);
});
core.patch('/projects/:id', async (c) => {
  const p = projects.update(c.req.param('id'), await c.req.json());
  if (!p) return c.json({ error: 'Not found' }, 404);
  bus.emitEvent({ type: 'project.updated', message: `Project updated: ${p.name}`, workspaceId: p.workspaceId, projectId: p.id });
  bus.notify('project', p.id, p.id);
  return c.json(p);
});
core.delete('/projects/:id', (c) => { projects.delete(c.req.param('id')); return c.json({ ok: true }); });
core.get('/projects/:id/policy', (c) => c.json(getPolicy('project', c.req.param('id'))));
core.put('/projects/:id/policy', async (c) => { setPolicy('project', c.req.param('id'), await c.req.json()); return c.json({ ok: true }); });

// ---------- connections ----------
core.get('/connections', (c) => c.json(connections.list(c.req.query('projectId'))));
core.get('/connections/:id', (c) => {
  const conn = connections.get(c.req.param('id'));
  return conn ? c.json(conn) : c.json({ error: 'Not found' }, 404);
});
core.post('/connections', async (c) => {
  const body = await c.req.json<ConnectionInput>();
  const conn = connections.create(body);
  bus.notify('connection', conn.id, conn.projectId);
  void testConnection(conn.id);
  return c.json(conn, 201);
});
core.patch('/connections/:id', async (c) => {
  const id = c.req.param('id');
  const conn = connections.update(id, await c.req.json());
  if (!conn) return c.json({ error: 'Not found' }, 404);
  await dropAdapter(id);
  bus.notify('connection', conn.id, conn.projectId);
  return c.json(conn);
});
core.delete('/connections/:id', async (c) => {
  const id = c.req.param('id');
  await dropAdapter(id);
  connections.delete(id);
  return c.json({ ok: true });
});
core.post('/connections/:id/test', async (c) => c.json(await testConnection(c.req.param('id'))));

// ---------- schema ----------
core.get('/connections/:id/schema', async (c) => {
  const refresh = c.req.query('refresh') === '1';
  const snap = await getSnapshot(c.req.param('id'), refresh);
  return c.json(snap);
});
core.post('/connections/:id/schema/refresh', async (c) => c.json(await refreshSnapshot(c.req.param('id'))));
core.get('/connections/:id/tables/:table', async (c) => {
  const snap = await getSnapshot(c.req.param('id'));
  const t = findTable(snap, c.req.param('table'));
  if (!t) return c.json({ error: 'Table not found' }, 404);
  const referencedBy = snap.tables.filter((x) => x.foreignKeys.some((fk) => fk.refTable === t.name && fk.refSchema === t.schema)).map((x) => ({ table: tableKey(x.schema, x.name), foreignKeys: x.foreignKeys.filter((fk) => fk.refTable === t.name) }));
  return c.json({ table: t, ddl: generateTableDdl(t, snap.engine), referencedBy, findings: lintTables([t]) });
});
core.get('/connections/:id/lint', async (c) => {
  const snap = await getSnapshot(c.req.param('id'));
  return c.json({ findings: lintTables(snap.tables), tables: snap.tables.length });
});
core.get('/connections/:id/layout', (c) => c.json(layouts.get(c.req.param('id')) ?? { connectionId: c.req.param('id'), positions: {}, hidden: [], updatedAt: null }));
core.put('/connections/:id/layout', async (c) => {
  const body = await c.req.json<{ positions: Record<string, { x: number; y: number }>; hidden: string[] }>();
  return c.json(layouts.save({ connectionId: c.req.param('id'), positions: body.positions ?? {}, hidden: body.hidden ?? [], updatedAt: '' }));
});

// ---------- SQL ----------
core.post('/sql/classify', async (c) => {
  const { sql } = await c.req.json<{ sql: string }>();
  return c.json({ ...classifySql(sql), tables: referencedTables(sql) });
});
core.post('/sql/execute', async (c) => {
  const body = await c.req.json<{ connectionId: string; sql: string; dryRun?: boolean; maxRows?: number; confirmRisk?: boolean }>();
  const cls = classifySql(body.sql);
  if (cls.risk !== 'safe' && !body.confirmRisk) {
    return c.json({ error: 'confirmation_required', classification: cls, message: `This statement is classified as ${cls.risk} (${cls.reasons.join('; ')}). Confirm to execute.` }, 409);
  }
  const out = await executeSql(body.connectionId, body.sql, { actorType: 'user', dryRun: body.dryRun, maxRows: body.maxRows, tags: [] });
  return c.json(out, out.error ? 400 : 200);
});
core.post('/sql/explain', async (c) => {
  const body = await c.req.json<{ connectionId: string; sql: string; analyze?: boolean }>();
  const plan = await explainSql(body.connectionId, body.sql, !!body.analyze);
  return c.json({ plan });
});
core.get('/sql/history', (c) => c.json(queryHistory.list({ projectId: c.req.query('projectId'), connectionId: c.req.query('connectionId'), limit: Number(c.req.query('limit') ?? 100) })));
core.get('/sql/saved', (c) => c.json(savedQueries.list(c.req.query('projectId'))));
core.post('/sql/saved', async (c) => c.json(savedQueries.create(await c.req.json()), 201));
core.patch('/sql/saved/:id', async (c) => c.json(savedQueries.update(c.req.param('id'), await c.req.json())));
core.delete('/sql/saved/:id', (c) => { savedQueries.delete(c.req.param('id')); return c.json({ ok: true }); });
