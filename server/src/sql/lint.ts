import type { TableInfo } from '@schemaforge/shared';

export interface LintFinding {
  code: string;
  severity: 'high' | 'medium' | 'low' | 'info';
  table: string;
  column: string | null;
  message: string;
  suggestion: string | null;
}

/** Deterministic schema quality checks. No AI involved. */
export function lintTables(tables: TableInfo[], knownTables?: Iterable<string>): LintFinding[] {
  const out: LintFinding[] = [];
  const names = new Set(tables.map((t) => t.name.toLowerCase()));
  const known = new Set([...names, ...[...(knownTables ?? [])].map((n) => n.toLowerCase())]);
  const referenced = new Set<string>();
  for (const t of tables) for (const fk of t.foreignKeys) referenced.add(fk.refTable.toLowerCase());

  for (const t of tables) {
    if (t.kind !== 'table') continue;
    const cols = t.columns;
    if (t.primaryKey.length === 0) {
      out.push({ code: 'NO_PRIMARY_KEY', severity: 'high', table: t.name, column: null, message: 'Table has no primary key.', suggestion: 'Add a surrogate key (bigint identity/uuid) or declare the natural key as PRIMARY KEY.' });
    }
    const indexedLeading = new Set(t.indexes.map((i) => i.columns[0]?.toLowerCase()).filter(Boolean));
    if (t.primaryKey[0]) indexedLeading.add(t.primaryKey[0].toLowerCase());
    for (const fk of t.foreignKeys) {
      const lead = fk.columns[0]?.toLowerCase();
      if (lead && !indexedLeading.has(lead)) {
        out.push({ code: 'FK_NOT_INDEXED', severity: 'medium', table: t.name, column: fk.columns[0], message: `Foreign key ${fk.columns.join(', ')} → ${fk.refTable} has no supporting index.`, suggestion: `CREATE INDEX ix_${t.name}_${fk.columns.join('_')} ON ${t.name} (${fk.columns.join(', ')});` });
      }
      for (const c of fk.columns) {
        const col = cols.find((x) => x.name === c);
        if (col?.nullable) out.push({ code: 'NULLABLE_FK', severity: 'info', table: t.name, column: c, message: `Foreign key column ${c} is nullable (optional relationship).`, suggestion: 'Confirm the relationship is intentionally optional; otherwise add NOT NULL.' });
      }
      if (!known.has(fk.refTable.toLowerCase())) {
        out.push({ code: 'FK_TARGET_MISSING', severity: 'high', table: t.name, column: fk.columns[0], message: `Foreign key references ${fk.refTable}, which is not in the inspected schema.`, suggestion: null });
      }
    }
    const fkCols = new Set(t.foreignKeys.flatMap((f) => f.columns.map((c) => c.toLowerCase())));
    for (const c of cols) {
      const n = c.name.toLowerCase();
      if (/_id$/.test(n) && !c.isPrimaryKey && !fkCols.has(n)) {
        const target = n.replace(/_id$/, '');
        const candidates = [target, target + 's', target + 'es', target.replace(/y$/, 'ies')].filter((x) => names.has(x));
        out.push({ code: 'IMPLICIT_RELATIONSHIP', severity: candidates.length ? 'medium' : 'low', table: t.name, column: c.name, message: `Column ${c.name} looks like a reference${candidates.length ? ` to ${candidates[0]}` : ''} but has no foreign key constraint.`, suggestion: candidates.length ? `ALTER TABLE ${t.name} ADD FOREIGN KEY (${c.name}) REFERENCES ${candidates[0]} (id);` : null });
      }
      if (/^(email|code|sku|slug|username|pan|isin)$/.test(n)) {
        const unique = t.indexes.some((i) => i.unique && i.columns.length === 1 && i.columns[0].toLowerCase() === n) || t.constraints.some((k) => k.type === 'UNIQUE' && k.definition.toLowerCase().includes(n));
        if (!unique) out.push({ code: 'LIKELY_UNIQUE', severity: 'low', table: t.name, column: c.name, message: `Column ${c.name} usually holds unique values but has no unique constraint.`, suggestion: `CREATE UNIQUE INDEX ux_${t.name}_${c.name} ON ${t.name} (${c.name});` });
      }
      if (/^(amount|price|balance|total|value|nav|units)/.test(n) && /(float|real|double)/i.test(c.dataType)) {
        out.push({ code: 'FLOAT_MONEY', severity: 'medium', table: t.name, column: c.name, message: `Monetary-looking column ${c.name} uses a floating-point type (${c.dataType}).`, suggestion: 'Use NUMERIC/DECIMAL with explicit scale for money and units.' });
      }
      if (/\b(text|varchar|character varying)\b/i.test(c.dataType) && /(_at|_date|date)$/.test(n) && t.schema !== 'main') {
        out.push({ code: 'TEXT_DATE', severity: 'low', table: t.name, column: c.name, message: `Date-like column ${c.name} is stored as text.`, suggestion: 'Use DATE/TIMESTAMPTZ so range queries and indexes work correctly.' });
      }
    }
    if (!cols.some((c) => /^(created_at|created_on|inserted_at|created)$/i.test(c.name))) {
      out.push({ code: 'NO_CREATED_AT', severity: 'low', table: t.name, column: null, message: 'No creation timestamp column (created_at).', suggestion: 'Add created_at with a default of now() for auditability.' });
    }
    if (cols.length > 30) {
      out.push({ code: 'WIDE_TABLE', severity: 'low', table: t.name, column: null, message: `Table has ${cols.length} columns; consider whether it mixes several concerns.`, suggestion: 'Split rarely-used or optional groups of columns into related tables.' });
    }
    // Redundant indexes: an index whose column list is a prefix of another index.
    for (const a of t.indexes) {
      for (const b of t.indexes) {
        if (a === b || a.primary || a.columns.length === 0) continue;
        if (b.columns.length > a.columns.length && a.columns.every((c, i) => b.columns[i] === c) && !a.unique) {
          out.push({ code: 'REDUNDANT_INDEX', severity: 'low', table: t.name, column: a.columns[0], message: `Index ${a.name} (${a.columns.join(', ')}) is a prefix of ${b.name}.`, suggestion: `DROP INDEX ${a.name}; -- covered by ${b.name}` });
        }
      }
    }
    if ((t.rowEstimate ?? 0) > 50_000 && t.indexes.filter((i) => !i.primary).length === 0) {
      out.push({ code: 'LARGE_TABLE_NO_INDEX', severity: 'medium', table: t.name, column: null, message: `Table has ~${t.rowEstimate} rows and no secondary indexes.`, suggestion: 'Add indexes for the columns used in WHERE/JOIN clauses of frequent queries.' });
    }
    if (t.foreignKeys.length === 0 && !referenced.has(t.name.toLowerCase()) && tables.length > 3) {
      out.push({ code: 'ISOLATED_TABLE', severity: 'info', table: t.name, column: null, message: 'Table is not related to any other inspected table via foreign keys.', suggestion: null });
    }
  }
  // Naming consistency: mixed singular/plural table names.
  const plural = tables.filter((t) => /s$/.test(t.name)).length;
  const singular = tables.length - plural;
  if (tables.length >= 4 && plural > 0 && singular > 0 && Math.min(plural, singular) / tables.length > 0.25) {
    out.push({ code: 'MIXED_NAMING', severity: 'low', table: '(schema)', column: null, message: `Table names mix singular (${singular}) and plural (${plural}) forms.`, suggestion: 'Pick one convention and record it in project knowledge.' });
  }
  const order = { high: 0, medium: 1, low: 2, info: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity] || a.table.localeCompare(b.table));
}

export function formatLintReport(tables: TableInfo[], findings: LintFinding[]): string {
  const lines: string[] = ['# Schema analysis', '', `Tables inspected: ${tables.map((t) => `\`${t.name}\``).join(', ')}`, ''];
  const counts = ['high', 'medium', 'low', 'info'].map((s) => `${s}: ${findings.filter((f) => f.severity === s).length}`).join(' · ');
  lines.push(`Findings: ${findings.length} (${counts})`, '');
  lines.push('## Findings', '');
  if (findings.length === 0) lines.push('No issues detected by the deterministic checks.');
  for (const f of findings) {
    lines.push(`### [${f.severity.toUpperCase()}] ${f.code} — ${f.table}${f.column ? '.' + f.column : ''}`, f.message);
    if (f.suggestion) lines.push('', /^(CREATE|ALTER|DROP)/.test(f.suggestion) ? '```sql\n' + f.suggestion + '\n```' : `Suggestion: ${f.suggestion}`);
    lines.push('');
  }
  lines.push('## Table summary', '', '| Table | Rows | Columns | PK | FKs | Indexes |', '|---|---|---|---|---|---|');
  for (const t of tables) lines.push(`| ${t.name} | ${t.rowEstimate ?? '?'} | ${t.columns.length} | ${t.primaryKey.join(', ') || '—'} | ${t.foreignKeys.length} | ${t.indexes.length} |`);
  return lines.join('\n');
}
