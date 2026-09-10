import type { DbEngine, QueryResult, SchemaSnapshot } from '@schemaforge/shared';

export interface QueryOptions {
  maxRows?: number;
  timeoutMs?: number;
  /** Run inside a transaction that is rolled back afterwards (dry-run). */
  dryRun?: boolean;
}

export interface DbAdapter {
  readonly engine: DbEngine;
  test(): Promise<{ ok: true; serverVersion: string }>;
  introspect(schemas?: string[]): Promise<Omit<SchemaSnapshot, 'connectionId' | 'capturedAt'>>;
  query(sql: string, opts?: QueryOptions): Promise<QueryResult>;
  explain(sql: string, analyze?: boolean): Promise<string>;
  tableDdl(schema: string, table: string): Promise<string>;
  close(): Promise<void>;
}

export interface AdapterConfig {
  engine: DbEngine;
  host?: string | null;
  port?: number | null;
  database: string;
  username?: string | null;
  password?: string | null;
  ssl?: boolean;
  filePath?: string | null;
  readOnly?: boolean;
}
