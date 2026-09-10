import type { DatabaseConnection, QueryResult, SchemaSnapshot, SqlClassification, TableInfo } from '@schemaforge/shared';
import { tableKey } from '@schemaforge/shared';
import type { DbAdapter, QueryOptions } from './adapter.js';
import { PostgresAdapter } from './postgres.js';
import { SqliteAdapter } from './sqlite.js';
import { connections, projects, queryHistory, snapshots } from '../store/repos.js';
import { bus } from '../events.js';
import { classifySql } from '../sql/classify.js';
import { config } from '../config.js';
import { redactSecrets } from '../secrets.js';
import { now } from '../store/db.js';

const adapters = new Map<string, DbAdapter>();

export function createAdapter(conn: DatabaseConnection, password: string | null): DbAdapter {
  const cfg = {
    engine: conn.engine, host: conn.host, port: conn.port, database: conn.database, username: conn.username,
    password, ssl: conn.ssl, filePath: conn.filePath, readOnly: conn.readOnly,
  };
  if (conn.engine === 'postgres') return new PostgresAdapter(cfg);
  if (conn.engine === 'sqlite') return new SqliteAdapter(cfg);
  throw new Error(`Unsupported engine: ${conn.engine}`);
}

export function getAdapter(connectionId: string): DbAdapter {
  const existing = adapters.get(connectionId);
  if (existing) return existing;
  const conn = connections.get(connectionId);
  if (!conn) throw new Error(`Connection ${connectionId} not found`);
  const adapter = createAdapter(conn, connections.getPassword(connectionId));
  adapters.set(connectionId, adapter);
  return adapter;
}

export async function dropAdapter(connectionId: string): Promise<void> {
  const a = adapters.get(connectionId);
  adapters.delete(connectionId);
  if (a) await a.close().catch(() => undefined);
}

function sanitizeError(connectionId: string, e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return redactSecrets(msg, [connections.getPassword(connectionId)]);
}

export async function testConnection(connectionId: string): Promise<{ ok: boolean; serverVersion?: string; error?: string }> {
  const conn = connections.get(connectionId);
  if (!conn) throw new Error('Connection not found');
  const project = projects.get(conn.projectId);
  try {
    await dropAdapter(connectionId);
    const r = await getAdapter(connectionId).test();
    connections.setStatus(connectionId, 'connected', null);
    bus.emitEvent({ type: 'connection.updated', message: `Connected to ${conn.name} (${r.serverVersion.split(',')[0]})`, workspaceId: project?.workspaceId ?? '', projectId: conn.projectId, connectionId });
    bus.notify('connection', connectionId, conn.projectId);
    return { ok: true, serverVersion: r.serverVersion };
  } catch (e) {
    const error = sanitizeError(connectionId, e);
    connections.setStatus(connectionId, 'error', error);
    bus.emitEvent({ type: 'connection.updated', level: 'error', message: `Connection ${conn.name} failed: ${error}`, workspaceId: project?.workspaceId ?? '', projectId: conn.projectId, connectionId });
    bus.notify('connection', connectionId, conn.projectId);
    return { ok: false, error };
  }
}

export async function refreshSnapshot(connectionId: string): Promise<SchemaSnapshot> {
  const conn = connections.get(connectionId);
  if (!conn) throw new Error('Connection not found');
  try {
    const partial = await getAdapter(connectionId).introspect(conn.schemas.length ? conn.schemas : undefined);
    const snap: SchemaSnapshot = { ...partial, connectionId, capturedAt: now() };
    snapshots.save(snap);
    if (conn.status !== 'connected') {
      connections.setStatus(connectionId, 'connected', null);
      bus.notify('connection', connectionId, conn.projectId);
    }
    return snap;
  } catch (e) {
    const error = sanitizeError(connectionId, e);
    connections.setStatus(connectionId, 'error', error);
    bus.notify('connection', connectionId, conn.projectId);
    throw new Error(error);
  }
}

export async function getSnapshot(connectionId: string, refresh = false): Promise<SchemaSnapshot> {
  if (!refresh) {
    const cached = snapshots.get(connectionId);
    if (cached) return cached;
  }
  return refreshSnapshot(connectionId);
}

export function findTable(snap: SchemaSnapshot, ref: string): TableInfo | undefined {
  const lower = ref.toLowerCase().replace(/"/g, '');
  return snap.tables.find((t) => tableKey(t.schema, t.name).toLowerCase() === lower)
    ?? snap.tables.find((t) => t.name.toLowerCase() === lower)
    ?? snap.tables.find((t) => t.name.toLowerCase() === lower.split('.').pop());
}

export interface ExecuteOptions extends QueryOptions {
  actorType: 'user' | 'agent';
  actorId?: string | null;
  taskId?: string | null;
  runId?: string | null;
  tags?: string[];
}

export interface ExecuteOutcome {
  result: QueryResult | null;
  error: string | null;
  classification: SqlClassification;
  historyId: string;
}

/** Execute SQL against a connection, record history and emit an event. Permission checks happen before this. */
export async function executeSql(connectionId: string, sql: string, opts: ExecuteOptions): Promise<ExecuteOutcome> {
  const conn = connections.get(connectionId);
  if (!conn) throw new Error('Connection not found');
  const project = projects.get(conn.projectId);
  const classification = classifySql(sql);
  if (conn.readOnly && classification.risk !== 'safe') {
    throw new Error(`Connection "${conn.name}" is read-only; ${classification.statementType} is not allowed`);
  }
  const started = Date.now();
  let result: QueryResult | null = null;
  let error: string | null = null;
  try {
    result = await getAdapter(connectionId).query(sql, { maxRows: opts.maxRows ?? config.maxRows, timeoutMs: opts.timeoutMs ?? config.queryTimeoutMs, dryRun: opts.dryRun });
  } catch (e) {
    error = sanitizeError(connectionId, e);
  }
  const durationMs = result?.durationMs ?? Date.now() - started;
  const h = queryHistory.add({
    projectId: conn.projectId, connectionId, sql, status: error ? 'error' : 'ok', durationMs,
    rowCount: result ? (result.affectedRows ?? result.rowCount) : null, error, actorType: opts.actorType,
    actorId: opts.actorId ?? null, taskId: opts.taskId ?? null, tags: opts.tags ?? [],
  });
  bus.emitEvent({
    type: 'sql.executed', level: error ? 'error' : 'info',
    message: error ? `SQL failed (${classification.statementType}): ${error}` : `SQL ${classification.statementType} ok · ${result?.affectedRows ?? result?.rowCount ?? 0} rows · ${durationMs}ms`,
    workspaceId: project?.workspaceId ?? '', projectId: conn.projectId, connectionId,
    agentId: opts.actorType === 'agent' ? opts.actorId ?? null : null, taskId: opts.taskId ?? null, runId: opts.runId ?? null,
    data: { sql: sql.slice(0, 4000), risk: classification.risk, durationMs, rowCount: result?.rowCount ?? null, error, historyId: h.id, dryRun: !!opts.dryRun },
  });
  return { result, error, classification, historyId: h.id };
}

export async function explainSql(connectionId: string, sql: string, analyze = false): Promise<string> {
  const conn = connections.get(connectionId);
  if (!conn) throw new Error('Connection not found');
  if (analyze && classifySql(sql).risk !== 'safe') throw new Error('EXPLAIN ANALYZE is only allowed for read-only statements');
  try {
    return await getAdapter(connectionId).explain(sql, analyze);
  } catch (e) {
    throw new Error(sanitizeError(connectionId, e));
  }
}

export async function closeAll(): Promise<void> {
  await Promise.all([...adapters.keys()].map((id) => dropAdapter(id)));
}
