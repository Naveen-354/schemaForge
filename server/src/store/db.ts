import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { config } from '../config.js';

export type Row = Record<string, unknown>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  root_path TEXT, instructions TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, engine TEXT NOT NULL,
  host TEXT, port INTEGER, database TEXT NOT NULL, username TEXT, password_enc TEXT, ssl INTEGER NOT NULL DEFAULT 0,
  file_path TEXT, schemas TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'unknown', last_error TEXT,
  read_only INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS schema_snapshots (
  connection_id TEXT PRIMARY KEY, captured_at TEXT NOT NULL, snapshot TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS diagram_layouts (
  connection_id TEXT PRIMARY KEY, positions TEXT NOT NULL, hidden TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT, name TEXT NOT NULL, role TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL, model TEXT NOT NULL, capabilities TEXT NOT NULL DEFAULT '[]',
  permissions TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'IDLE', status_message TEXT, current_task_id TEXT, current_run_id TEXT,
  max_iterations INTEGER NOT NULL DEFAULT 20, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, connection_id TEXT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  agent_id TEXT, priority TEXT NOT NULL DEFAULT 'normal', status TEXT NOT NULL DEFAULT 'TODO', depends_on TEXT NOT NULL DEFAULT '[]',
  context TEXT NOT NULL DEFAULT '{}', result TEXT, error TEXT, current_run_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, completed_at TEXT
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, agent_id TEXT NOT NULL, project_id TEXT NOT NULL, status TEXT NOT NULL,
  iterations INTEGER NOT NULL DEFAULT 0, provider TEXT NOT NULL, model TEXT NOT NULL, usage TEXT NOT NULL,
  error TEXT, started_at TEXT NOT NULL, ended_at TEXT
);
CREATE TABLE IF NOT EXISTS run_messages (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, seq INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
  tool_name TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_messages_run ON run_messages(run_id, seq);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, type TEXT NOT NULL, level TEXT NOT NULL,
  workspace_id TEXT NOT NULL, project_id TEXT, agent_id TEXT, task_id TEXT, run_id TEXT, connection_id TEXT,
  message TEXT NOT NULL, data TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id);
CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL, agent_id TEXT NOT NULL, run_id TEXT NOT NULL,
  tool_name TEXT NOT NULL, summary TEXT NOT NULL, detail TEXT NOT NULL, risk TEXT NOT NULL, input TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', resolution TEXT, created_at TEXT NOT NULL, resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT, agent_id TEXT, run_id TEXT, type TEXT NOT NULL,
  title TEXT NOT NULL, content TEXT NOT NULL, language TEXT, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge (
  id TEXT PRIMARY KEY, project_id TEXT, scope TEXT NOT NULL, agent_id TEXT, category TEXT NOT NULL, title TEXT NOT NULL,
  content TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS query_history (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, connection_id TEXT NOT NULL, sql TEXT NOT NULL, status TEXT NOT NULL,
  duration_ms INTEGER NOT NULL, row_count INTEGER, error TEXT, actor_type TEXT NOT NULL, actor_id TEXT, task_id TEXT,
  tags TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS saved_queries (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, connection_id TEXT, name TEXT NOT NULL, sql TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);
`;

let db: DatabaseSync | null = null;

export function openDb(file?: string): DatabaseSync {
  if (db) return db;
  const dbPath = file ?? path.join(config.dataDir, 'schemaforge.db');
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function getDb(): DatabaseSync {
  return db ?? openDb();
}

/** Open a throwaway in-memory app database (tests). */
export function openMemoryDb(): DatabaseSync {
  db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return db;
}

export function now(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

export function j(v: unknown): string {
  return JSON.stringify(v ?? null);
}

export function pj<T>(v: unknown, fallback: T): T {
  if (v == null || v === '') return fallback;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
}
