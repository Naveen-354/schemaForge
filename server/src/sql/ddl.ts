import type { DbEngine, TableInfo } from '@schemaforge/shared';

function q(id: string, engine: DbEngine): string {
  if (engine === 'postgres' && /^[a-z_][a-z0-9_]*$/.test(id)) return id;
  return `"${id.replace(/"/g, '""')}"`;
}

/** Generate a readable CREATE TABLE statement from introspected metadata. */
export function generateTableDdl(t: TableInfo, engine: DbEngine): string {
  if (t.kind !== 'table') {
    const kw = t.kind === 'materialized_view' ? 'CREATE MATERIALIZED VIEW' : 'CREATE VIEW';
    return `${kw} ${q(t.schema, engine)}.${q(t.name, engine)} AS\n${t.definition ?? '-- definition unavailable'}`;
  }
  if (engine === 'sqlite' && t.definition) return t.definition + ';';
  const name = engine === 'sqlite' ? q(t.name, engine) : `${q(t.schema, engine)}.${q(t.name, engine)}`;
  const lines: string[] = [];
  for (const c of t.columns) {
    let line = `  ${q(c.name, engine)} ${c.dataType}`;
    if (!c.nullable) line += ' NOT NULL';
    if (c.defaultValue != null) line += ` DEFAULT ${c.defaultValue}`;
    lines.push(line);
  }
  if (t.primaryKey.length) lines.push(`  PRIMARY KEY (${t.primaryKey.map((c) => q(c, engine)).join(', ')})`);
  for (const c of t.constraints) {
    if (c.type === 'PRIMARY KEY') continue;
    if (c.type === 'FOREIGN KEY') {
      lines.push(`  CONSTRAINT ${q(c.name, engine)} ${c.definition}`);
    } else if (c.type === 'UNIQUE' || c.type === 'CHECK' || c.type === 'EXCLUDE') {
      lines.push(`  CONSTRAINT ${q(c.name, engine)} ${c.definition}`);
    }
  }
  const out = [`CREATE TABLE ${name} (\n${lines.join(',\n')}\n);`];
  for (const idx of t.indexes) {
    if (idx.primary) continue;
    if (idx.definition) out.push(idx.definition.endsWith(';') ? idx.definition : idx.definition + ';');
    else out.push(`CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX ${q(idx.name, engine)} ON ${name} (${idx.columns.map((c) => q(c, engine)).join(', ')});`);
  }
  if (t.comment) out.push(`COMMENT ON TABLE ${name} IS '${t.comment.replace(/'/g, "''")}';`);
  return out.join('\n');
}
