import pg from 'pg';
import type { ColumnInfo, ConstraintInfo, ForeignKeyInfo, IndexInfo, QueryResult, RoutineInfo, SchemaSnapshot, TableInfo, TriggerInfo } from '@schemaforge/shared';
import type { AdapterConfig, DbAdapter, QueryOptions } from './adapter.js';
import { generateTableDdl } from '../sql/ddl.js';
import { tableKey } from '@schemaforge/shared';

const { Pool, types } = pg;
// Keep numerics/bigints as strings (default) but parse dates as ISO strings for JSON safety.
types.setTypeParser(1114, (v) => v); // timestamp
types.setTypeParser(1184, (v) => v); // timestamptz
types.setTypeParser(1082, (v) => v); // date

const OID_NAMES: Record<number, string> = {
  16: 'bool', 17: 'bytea', 18: 'char', 19: 'name', 20: 'int8', 21: 'int2', 23: 'int4', 25: 'text', 26: 'oid', 114: 'json', 142: 'xml',
  700: 'float4', 701: 'float8', 790: 'money', 1042: 'bpchar', 1043: 'varchar', 1082: 'date', 1083: 'time', 1114: 'timestamp',
  1184: 'timestamptz', 1186: 'interval', 1266: 'timetz', 1700: 'numeric', 2950: 'uuid', 3802: 'jsonb', 2249: 'record',
  1000: 'bool[]', 1003: 'name[]', 1005: 'int2[]', 1007: 'int4[]', 1009: 'text[]', 1015: 'varchar[]', 1016: 'int8[]',
  1021: 'float4[]', 1022: 'float8[]', 1115: 'timestamp[]', 1182: 'date[]', 1185: 'timestamptz[]', 1231: 'numeric[]', 2951: 'uuid[]', 3807: 'jsonb[]', 199: 'json[]',
};

/** node-pg leaves some array types (e.g. name[]) as their text literal; normalize to string[]. */
function pgArray(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String);
  const s = String(v).trim();
  if (!s.startsWith('{')) return [s];
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 1; i < s.length - 1; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '\\') { cur += s[++i]; continue; }
      if (c === '"') { quoted = false; continue; }
      cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  if (cur !== '' || s.length > 2) out.push(cur);
  return out.filter((x) => x !== '' && x !== 'NULL');
}

const FK_ACTION: Record<string, string> = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };
const CON_TYPE: Record<string, string> = { p: 'PRIMARY KEY', u: 'UNIQUE', c: 'CHECK', f: 'FOREIGN KEY', x: 'EXCLUDE', t: 'TRIGGER' };

export class PostgresAdapter implements DbAdapter {
  readonly engine = 'postgres' as const;
  private pool: pg.Pool;
  private readOnly: boolean;

  constructor(cfg: AdapterConfig) {
    this.readOnly = !!cfg.readOnly;
    this.pool = new Pool({
      host: cfg.host ?? 'localhost',
      port: cfg.port ?? 5432,
      database: cfg.database,
      user: cfg.username ?? undefined,
      password: cfg.password ?? undefined,
      ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
      max: 3,
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 8_000,
    });
    this.pool.on('error', () => { /* keep pool alive; errors surface on next query */ });
  }

  async test() {
    const r = await this.pool.query('SELECT version() AS v');
    return { ok: true as const, serverVersion: String(r.rows[0].v) };
  }

  private async listSchemas(): Promise<string[]> {
    const r = await this.pool.query(
      `SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND nspname NOT LIKE 'pg_temp_%' AND nspname NOT LIKE 'pg_toast_temp_%' ORDER BY nspname`,
    );
    return r.rows.map((x) => String(x.nspname));
  }

  async introspect(schemas?: string[]): Promise<Omit<SchemaSnapshot, 'connectionId' | 'capturedAt'>> {
    const schemaList = schemas && schemas.length ? schemas : await this.listSchemas();
    const p = [schemaList];

    const [tablesR, colsR, consR, idxR, routinesR, trigR] = await Promise.all([
      this.pool.query(
        `SELECT n.nspname AS schema, c.relname AS name, c.relkind, c.reltuples::bigint AS row_estimate,
                obj_description(c.oid, 'pg_class') AS comment,
                CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid, true) END AS definition
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind IN ('r','p','v','m') AND n.nspname = ANY($1) ORDER BY 1, 2`, p),
      this.pool.query(
        `SELECT n.nspname AS schema, c.relname AS table, a.attname AS name, a.attnum AS ordinal, NOT a.attnotnull AS nullable,
                pg_get_expr(d.adbin, d.adrelid) AS default_value, format_type(a.atttypid, a.atttypmod) AS data_type,
                col_description(c.oid, a.attnum) AS comment
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m') AND n.nspname = ANY($1)
         ORDER BY 1, 2, a.attnum`, p),
      this.pool.query(
        `SELECT n.nspname AS schema, c.relname AS table, con.conname AS name, con.contype, pg_get_constraintdef(con.oid) AS definition,
                (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
                   JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS cols,
                fn.nspname AS ref_schema, fc.relname AS ref_table,
                (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
                   JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum) AS ref_cols,
                con.confdeltype, con.confupdtype
         FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_class fc ON fc.oid = con.confrelid LEFT JOIN pg_namespace fn ON fn.oid = fc.relnamespace
         WHERE n.nspname = ANY($1) ORDER BY 1, 2, 3`, p),
      this.pool.query(
        `SELECT n.nspname AS schema, c.relname AS table, ic.relname AS name, i.indisunique AS is_unique, i.indisprimary AS is_primary,
                pg_get_indexdef(i.indexrelid) AS definition,
                (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
                   JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum WHERE k.attnum > 0) AS cols
         FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_class ic ON ic.oid = i.indexrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ANY($1) ORDER BY 1, 2, 3`, p),
      this.pool.query(
        `SELECT n.nspname AS schema, p.proname AS name, p.prokind, pg_get_function_result(p.oid) AS return_type,
                pg_get_function_arguments(p.oid) AS arguments, l.lanname AS language,
                CASE WHEN l.lanname IN ('sql','plpgsql') THEN p.prosrc END AS definition
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
         WHERE n.nspname = ANY($1) AND p.prokind IN ('f','p') ORDER BY 1, 2`, p),
      this.pool.query(
        `SELECT n.nspname AS schema, c.relname AS table, t.tgname AS name, pg_get_triggerdef(t.oid) AS definition
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE NOT t.tgisinternal AND n.nspname = ANY($1) ORDER BY 1, 2, 3`, p),
    ]);

    const tables = new Map<string, TableInfo>();
    for (const r of tablesR.rows) {
      const kind: TableInfo['kind'] = r.relkind === 'v' ? 'view' : r.relkind === 'm' ? 'materialized_view' : 'table';
      tables.set(tableKey(r.schema, r.name), {
        schema: r.schema, name: r.name, kind, columns: [], primaryKey: [], foreignKeys: [], indexes: [], constraints: [],
        rowEstimate: r.row_estimate == null || Number(r.row_estimate) < 0 ? null : Number(r.row_estimate),
        comment: r.comment ?? null, definition: r.definition ?? null,
      });
    }
    for (const r of colsR.rows) {
      const t = tables.get(tableKey(r.schema, r.table));
      if (!t) continue;
      const col: ColumnInfo = {
        name: r.name, dataType: r.data_type, nullable: !!r.nullable, defaultValue: r.default_value ?? null,
        isPrimaryKey: false, ordinal: Number(r.ordinal), comment: r.comment ?? null,
      };
      t.columns.push(col);
    }
    for (const r of consR.rows) {
      const t = tables.get(tableKey(r.schema, r.table));
      if (!t) continue;
      const cols: string[] = pgArray(r.cols);
      const c: ConstraintInfo = { name: r.name, type: CON_TYPE[r.contype] ?? r.contype, definition: r.definition };
      t.constraints.push(c);
      if (r.contype === 'p') {
        t.primaryKey = cols;
        for (const col of t.columns) if (cols.includes(col.name)) col.isPrimaryKey = true;
      } else if (r.contype === 'f') {
        const fk: ForeignKeyInfo = {
          name: r.name, columns: cols, refSchema: r.ref_schema, refTable: r.ref_table, refColumns: pgArray(r.ref_cols),
          onDelete: FK_ACTION[r.confdeltype] ?? null, onUpdate: FK_ACTION[r.confupdtype] ?? null,
        };
        t.foreignKeys.push(fk);
      }
    }
    for (const r of idxR.rows) {
      const t = tables.get(tableKey(r.schema, r.table));
      if (!t) continue;
      const idx: IndexInfo = { name: r.name, columns: pgArray(r.cols), unique: !!r.is_unique, primary: !!r.is_primary, definition: r.definition };
      t.indexes.push(idx);
    }
    const routines: RoutineInfo[] = routinesR.rows.map((r) => ({
      schema: r.schema, name: r.name, kind: r.prokind === 'p' ? 'procedure' : 'function', returnType: r.return_type ?? null,
      arguments: r.arguments ?? null, language: r.language ?? null, definition: r.definition ?? null,
    }));
    const triggers: TriggerInfo[] = trigR.rows.map((r) => {
      const def = String(r.definition ?? '');
      const m = /\b(BEFORE|AFTER|INSTEAD OF)\s+(.+?)\s+ON\b/i.exec(def);
      return { schema: r.schema, table: r.table, name: r.name, timing: m?.[1] ?? '', event: m?.[2] ?? '', definition: def };
    });
    return { engine: 'postgres', schemas: schemaList, tables: [...tables.values()], routines, triggers };
  }

  async query(sql: string, opts: QueryOptions = {}): Promise<QueryResult> {
    const maxRows = opts.maxRows ?? 1000;
    const client = await this.pool.connect();
    const started = Date.now();
    try {
      await client.query(`SET statement_timeout = ${Math.max(1000, opts.timeoutMs ?? 30_000)}`);
      if (this.readOnly) await client.query('SET default_transaction_read_only = on');
      if (opts.dryRun) await client.query('BEGIN');
      const res = await client.query({ text: sql, rowMode: 'array' });
      if (opts.dryRun) await client.query('ROLLBACK');
      const last = Array.isArray(res) ? res[res.length - 1] : res;
      const rows = (last.rows ?? []) as unknown[][];
      const truncated = rows.length > maxRows;
      return {
        columns: (last.fields ?? []).map((f: pg.FieldDef) => ({ name: f.name, type: OID_NAMES[f.dataTypeID] ?? String(f.dataTypeID) })),
        rows: truncated ? rows.slice(0, maxRows) : rows,
        rowCount: rows.length,
        affectedRows: last.command && !['SELECT', 'SHOW', 'EXPLAIN'].includes(last.command) ? last.rowCount ?? null : null,
        truncated,
        durationMs: Date.now() - started,
        command: last.command ?? null,
      };
    } catch (e) {
      if (opts.dryRun) await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async explain(sql: string, analyze = false): Promise<string> {
    const r = await this.query(`EXPLAIN (${analyze ? 'ANALYZE, BUFFERS, ' : ''}FORMAT TEXT) ${sql}`, { maxRows: 5000 });
    return r.rows.map((row) => String(row[0])).join('\n');
  }

  async tableDdl(schema: string, table: string): Promise<string> {
    const snap = await this.introspect([schema]);
    const t = snap.tables.find((x) => x.name === table);
    if (!t) throw new Error(`Table ${schema}.${table} not found`);
    return generateTableDdl(t, 'postgres');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
