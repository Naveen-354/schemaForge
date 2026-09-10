import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { ColumnInfo, ForeignKeyInfo, IndexInfo, QueryResult, RoutineInfo, SchemaSnapshot, TableInfo, TriggerInfo } from '@schemaforge/shared';
import type { AdapterConfig, DbAdapter, QueryOptions } from './adapter.js';
import { classifySql, splitStatements } from '../sql/classify.js';

type R = Record<string, unknown>;

export class SqliteAdapter implements DbAdapter {
  readonly engine = 'sqlite' as const;
  private db: DatabaseSync;

  constructor(cfg: AdapterConfig) {
    const file = cfg.filePath ?? cfg.database;
    if (!file) throw new Error('SQLite connection requires a file path');
    this.db = new DatabaseSync(file, { readOnly: !!cfg.readOnly });
  }

  async test() {
    const r = this.db.prepare('SELECT sqlite_version() AS v').get() as R;
    return { ok: true as const, serverVersion: `SQLite ${r.v}` };
  }

  async introspect(): Promise<Omit<SchemaSnapshot, 'connectionId' | 'capturedAt'>> {
    const objects = this.db.prepare(
      `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`,
    ).all() as R[];
    const tables: TableInfo[] = [];
    for (const o of objects.filter((x) => x.type === 'table' || x.type === 'view')) {
      const name = String(o.name);
      const cols = this.db.prepare(`PRAGMA table_info("${name.replace(/"/g, '""')}")`).all() as R[];
      const columns: ColumnInfo[] = cols.map((c) => ({
        name: String(c.name), dataType: String(c.type || 'ANY'), nullable: !Number(c.notnull) && !Number(c.pk),
        defaultValue: c.dflt_value == null ? null : String(c.dflt_value), isPrimaryKey: Number(c.pk) > 0,
        ordinal: Number(c.cid) + 1, comment: null,
      }));
      const primaryKey = cols.filter((c) => Number(c.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map((c) => String(c.name));
      const fkRows = o.type === 'table' ? (this.db.prepare(`PRAGMA foreign_key_list("${name.replace(/"/g, '""')}")`).all() as R[]) : [];
      const fkMap = new Map<number, ForeignKeyInfo>();
      for (const f of fkRows) {
        const id = Number(f.id);
        let fk = fkMap.get(id);
        if (!fk) {
          fk = { name: `fk_${name}_${id}`, columns: [], refSchema: 'main', refTable: String(f.table), refColumns: [], onDelete: String(f.on_delete), onUpdate: String(f.on_update) };
          fkMap.set(id, fk);
        }
        fk.columns.push(String(f.from));
        fk.refColumns.push(String(f.to));
      }
      const idxRows = o.type === 'table' ? (this.db.prepare(`PRAGMA index_list("${name.replace(/"/g, '""')}")`).all() as R[]) : [];
      const indexes: IndexInfo[] = idxRows.map((i) => {
        const iname = String(i.name);
        const icols = (this.db.prepare(`PRAGMA index_info("${iname.replace(/"/g, '""')}")`).all() as R[]).map((c) => String(c.name));
        const def = objects.find((x) => x.type === 'index' && x.name === iname)?.sql;
        return { name: iname, columns: icols, unique: !!Number(i.unique), primary: String(i.origin) === 'pk', definition: def ? String(def) : null };
      });
      let rowEstimate: number | null = null;
      if (o.type === 'table') {
        try { rowEstimate = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`).get() as R).n); } catch { rowEstimate = null; }
      }
      tables.push({
        schema: 'main', name, kind: o.type === 'view' ? 'view' : 'table', columns, primaryKey, foreignKeys: [...fkMap.values()],
        indexes, constraints: [
          ...(primaryKey.length ? [{ name: 'pk', type: 'PRIMARY KEY', definition: `PRIMARY KEY (${primaryKey.join(', ')})` }] : []),
          ...[...fkMap.values()].map((fk) => ({ name: fk.name, type: 'FOREIGN KEY', definition: `FOREIGN KEY (${fk.columns.join(', ')}) REFERENCES ${fk.refTable} (${fk.refColumns.join(', ')})` })),
        ],
        rowEstimate, comment: null, definition: o.sql ? String(o.sql) : null,
      });
    }
    const triggers: TriggerInfo[] = objects.filter((x) => x.type === 'trigger').map((t) => {
      const def = String(t.sql ?? '');
      const m = /\b(BEFORE|AFTER|INSTEAD OF)\s+(INSERT|UPDATE|DELETE)/i.exec(def);
      return { schema: 'main', table: String(t.tbl_name), name: String(t.name), timing: m?.[1] ?? '', event: m?.[2] ?? '', definition: def };
    });
    const routines: RoutineInfo[] = [];
    return { engine: 'sqlite', schemas: ['main'], tables, routines, triggers };
  }

  private columnsOf(stmt: StatementSync, sample: R | undefined): { name: string; type: string | null }[] {
    try {
      const cols = (stmt as unknown as { columns(): { name: string; type?: string | null }[] }).columns();
      if (cols?.length) return cols.map((c) => ({ name: c.name, type: c.type ?? null }));
    } catch { /* older node */ }
    return sample ? Object.keys(sample).map((name) => ({ name, type: null })) : [];
  }

  async query(sql: string, opts: QueryOptions = {}): Promise<QueryResult> {
    const maxRows = opts.maxRows ?? 1000;
    const started = Date.now();
    const parts = splitStatements(sql);
    const cls = classifySql(sql);
    if (opts.dryRun) this.db.exec('BEGIN');
    try {
      if (parts.length > 1) {
        // Multi-statement batch: execute without result sets.
        this.db.exec(sql);
        if (opts.dryRun) this.db.exec('ROLLBACK');
        return { columns: [], rows: [], rowCount: 0, affectedRows: null, truncated: false, durationMs: Date.now() - started, command: cls.statementType };
      }
      const stmt = this.db.prepare(sql);
      if (cls.risk === 'safe' || /^\s*(PRAGMA|EXPLAIN|WITH|SELECT)/i.test(sql)) {
        const rows = stmt.all() as R[];
        const columns = this.columnsOf(stmt, rows[0]);
        const arr = rows.map((r) => columns.map((c) => normalize(r[c.name])));
        const truncated = arr.length > maxRows;
        if (opts.dryRun) this.db.exec('ROLLBACK');
        return { columns, rows: truncated ? arr.slice(0, maxRows) : arr, rowCount: arr.length, affectedRows: null, truncated, durationMs: Date.now() - started, command: cls.statementType };
      }
      const res = stmt.run();
      if (opts.dryRun) this.db.exec('ROLLBACK');
      return { columns: [], rows: [], rowCount: 0, affectedRows: Number(res.changes), truncated: false, durationMs: Date.now() - started, command: cls.statementType };
    } catch (e) {
      if (opts.dryRun) { try { this.db.exec('ROLLBACK'); } catch { /* ignore */ } }
      throw e;
    }
  }

  async explain(sql: string): Promise<string> {
    const rows = this.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as R[];
    return rows.map((r) => `${'  '.repeat(Number(r.parent) > 0 ? 1 : 0)}${r.detail}`).join('\n') || '(no plan)';
  }

  async tableDdl(_schema: string, table: string): Promise<string> {
    const r = this.db.prepare(`SELECT sql FROM sqlite_master WHERE name = ? AND type IN ('table','view')`).get(table) as R | undefined;
    if (!r) throw new Error(`Table ${table} not found`);
    const idx = this.db.prepare(`SELECT sql FROM sqlite_master WHERE tbl_name = ? AND type = 'index' AND sql IS NOT NULL`).all(table) as R[];
    return [String(r.sql) + ';', ...idx.map((i) => String(i.sql) + ';')].join('\n');
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

function normalize(v: unknown): unknown {
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Uint8Array) return `<blob ${v.byteLength} bytes>`;
  return v;
}
