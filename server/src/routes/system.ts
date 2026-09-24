import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AppSettings, SearchHit, SfEvent, WorkspaceOverview } from '@schemaforge/shared';
import { tableKey } from '@schemaforge/shared';
import { agents, approvals, artifacts, connections, events, knowledge, projects, runs, savedQueries, settings, snapshots, tasks, workspaces } from '../store/repos.js';
import { bus } from '../events.js';
import { config } from '../config.js';
import { providerStatuses } from '../ai/providers/index.js';
import { oauthConfigured, oauthCredentials } from '../auth.js';

export const system = new Hono();

system.get('/health', (c) => c.json({ ok: true, version: config.version, time: new Date().toISOString() }));

// ---------- events ----------
system.get('/events', (c) => {
  const q = c.req.query();
  return c.json(events.list({
    workspaceId: q.workspaceId, projectId: q.projectId, agentId: q.agentId, taskId: q.taskId, runId: q.runId, connectionId: q.connectionId,
    type: q.type, level: q.level, afterSeq: q.afterSeq ? Number(q.afterSeq) : undefined, since: q.since, limit: q.limit ? Number(q.limit) : undefined,
  }));
});

/** Server-sent events: persisted domain events plus lightweight change notifications. */
system.get('/events/stream', (c) => {
  const afterSeq = Number(c.req.query('afterSeq') ?? 0);
  return streamSSE(c, async (stream) => {
    let id = 0;
    const onEvent = (e: SfEvent) => { void stream.writeSSE({ event: 'event', data: JSON.stringify(e), id: String(id++) }); };
    const onChange = (ch: unknown) => { void stream.writeSSE({ event: 'change', data: JSON.stringify(ch), id: String(id++) }); };
    bus.on('event', onEvent);
    bus.on('change', onChange);
    // Replay anything the client missed.
    if (afterSeq > 0) for (const e of events.list({ afterSeq, limit: 500 })) onEvent(e);
    await stream.writeSSE({ event: 'ready', data: JSON.stringify({ lastSeq: events.lastSeq() }) });
    const ping = setInterval(() => { void stream.writeSSE({ event: 'ping', data: String(Date.now()) }); }, 20_000);
    const closed = new Promise<void>((resolve) => { stream.onAbort(() => resolve()); });
    await closed;
    clearInterval(ping);
    bus.off('event', onEvent);
    bus.off('change', onChange);
  });
});

// ---------- overview ----------
system.get('/overview', (c) => {
  const workspaceId = c.req.query('workspaceId') ?? workspaces.list()[0]?.id;
  const ws = workspaceId ? workspaces.get(workspaceId) : null;
  if (!ws) return c.json({ error: 'No workspace' }, 404);
  const projs = projects.list(ws.id);
  const projectIds = new Set(projs.map((p) => p.id));
  const overview: WorkspaceOverview = {
    workspace: ws,
    projects: projs,
    agents: agents.list({ workspaceId: ws.id }),
    tasks: tasks.list().filter((t) => projectIds.has(t.projectId)).slice(0, 100),
    pendingApprovals: approvals.list({ status: 'pending' }).filter((a) => projectIds.has(a.projectId)),
    recentArtifacts: artifacts.list({ limit: 20 }).filter((a) => projectIds.has(a.projectId)),
    recentEvents: events.list({ workspaceId: ws.id, limit: 30 }),
    usage: runs.usageTotals(),
  };
  return c.json(overview);
});

// ---------- search ----------
system.get('/search', (c) => {
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const projectId = c.req.query('projectId');
  const limit = Number(c.req.query('limit') ?? 40);
  if (!q) return c.json([]);
  const hits: SearchHit[] = [];
  const has = (s: string | null | undefined) => (s ?? '').toLowerCase().includes(q);
  for (const p of projects.list()) if (has(p.name) || has(p.description)) hits.push({ kind: 'project', id: p.id, title: p.name, subtitle: p.description, projectId: p.id, ref: {} });
  for (const conn of connections.list(projectId)) {
    if (has(conn.name) || has(conn.database)) hits.push({ kind: 'connection', id: conn.id, title: conn.name, subtitle: `${conn.engine} · ${conn.database}`, projectId: conn.projectId, ref: {} });
    const snap = snapshots.get(conn.id);
    if (!snap) continue;
    for (const t of snap.tables) {
      const key = tableKey(t.schema, t.name);
      if (has(t.name)) hits.push({ kind: 'table', id: `${conn.id}:${key}`, title: key, subtitle: `${t.kind} · ${conn.name}`, projectId: conn.projectId, ref: { connectionId: conn.id, schema: t.schema, table: t.name } });
      for (const col of t.columns) if (has(col.name)) hits.push({ kind: 'column', id: `${conn.id}:${key}.${col.name}`, title: `${key}.${col.name}`, subtitle: `${col.dataType} · ${conn.name}`, projectId: conn.projectId, ref: { connectionId: conn.id, schema: t.schema, table: t.name, column: col.name } });
      if (hits.length > limit * 3) break;
    }
  }
  for (const a of agents.list({ projectId })) if (has(a.name) || has(a.role)) hits.push({ kind: 'agent', id: a.id, title: a.name, subtitle: `${a.role} · ${a.status}`, projectId: a.projectId, ref: {} });
  for (const t of tasks.list({ projectId })) if (has(t.title) || has(t.description)) hits.push({ kind: 'task', id: t.id, title: t.title, subtitle: t.status, projectId: t.projectId, ref: {} });
  for (const a of artifacts.list({ projectId, limit: 500 })) if (has(a.title) || has(a.content)) hits.push({ kind: 'artifact', id: a.id, title: a.title, subtitle: a.type, projectId: a.projectId, ref: {} });
  for (const s of savedQueries.list(projectId)) if (has(s.name) || has(s.sql)) hits.push({ kind: 'query', id: s.id, title: s.name, subtitle: s.sql.slice(0, 80), projectId: s.projectId, ref: { sql: s.sql, connectionId: s.connectionId } });
  for (const k of knowledge.list({ projectId })) if (has(k.title) || has(k.content) || k.tags.some((t) => has(t))) hits.push({ kind: 'knowledge', id: k.id, title: k.title, subtitle: k.category, projectId: k.projectId, ref: {} });
  for (const e of events.list({ projectId, limit: 500 })) if (has(e.message)) hits.push({ kind: 'event', id: e.id, title: e.message.slice(0, 100), subtitle: `${e.type} · ${e.createdAt}`, projectId: e.projectId, ref: { seq: e.seq, taskId: e.taskId, agentId: e.agentId } });
  return c.json(hits.slice(0, limit));
});

// ---------- settings ----------
const SECRET_KEYS = ['anthropic.apiKey', 'openai.apiKey', 'oauth.google.clientSecret', 'oauth.github.clientSecret'];
const PLAIN_KEYS = [
  'openai.baseUrl', 'openai.defaultModel', 'openai.models', 'openai.priceInputPerM', 'openai.priceOutputPerM', 'anthropic.fallbacks',
  'oauth.google.clientId', 'oauth.github.clientId',
];
/** Secrets that may instead come from the environment, so the UI can show them as set. */
const SECRET_ENV: Record<string, string | undefined> = { 'anthropic.apiKey': process.env.ANTHROPIC_API_KEY, 'openai.apiKey': process.env.OPENAI_API_KEY };

system.get('/settings', (c) => {
  const oauthInfo = (name: 'google' | 'github') => ({ configured: oauthConfigured(name), fromEnv: oauthCredentials(name).fromEnv });
  const s: AppSettings & {
    values: Record<string, string | null>;
    secrets: Record<string, boolean>;
    signIn: { publicUrl: string | null; google: { configured: boolean; fromEnv: boolean }; github: { configured: boolean; fromEnv: boolean } };
  } = {
    providers: providerStatuses(), dataDir: config.dataDir, version: config.version,
    values: Object.fromEntries(PLAIN_KEYS.map((k) => [k, settings.get(k)])),
    secrets: Object.fromEntries(SECRET_KEYS.map((k) => [k, !!settings.get(k) || !!SECRET_ENV[k]])),
    signIn: { publicUrl: config.publicUrl, google: oauthInfo('google'), github: oauthInfo('github') },
  };
  return c.json(s);
});
system.put('/settings', async (c) => {
  const body = await c.req.json<Record<string, string | null>>();
  for (const [k, v] of Object.entries(body)) {
    if (SECRET_KEYS.includes(k)) settings.setSecret(k, v || null);
    else if (PLAIN_KEYS.includes(k)) settings.set(k, v || null);
  }
  return c.json({ ok: true, providers: providerStatuses() });
});
