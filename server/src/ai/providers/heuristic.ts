import type { TableInfo } from '@schemaforge/shared';
import type { AiProvider, ChatMessage, CompletionRequest, CompletionResponse, CompletionUsage, ToolCall } from '../types.js';
import { lintTables, formatLintReport, type LintFinding } from '../../sql/lint.js';

/**
 * Deterministic, offline "agent brain". It drives the same tool loop a model would, using rules instead of a
 * model: inspect the schema, run deterministic analysis (schema lint, EXPLAIN, simple NL→SQL), and produce
 * artifacts. Useful with no API key, for tests, and for cheap deterministic work.
 */
export class HeuristicProvider implements AiProvider {
  readonly id = 'heuristic' as const;
  readonly name = 'Built-in heuristic (offline)';
  readonly defaultModel = 'heuristic-v1';
  isConfigured() { return true; }
  models() { return ['heuristic-v1']; }
  baseUrl() { return null; }
  estimateCostUsd() { return 0; }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const started = Date.now();
    const ctx = parseConversation(req.messages);
    const step = decide(ctx, req.tools.map((t) => t.name));
    const approxTokens = Math.ceil(JSON.stringify(req.messages).length / 4);
    const usage: CompletionUsage = { inputTokens: approxTokens, outputTokens: Math.ceil((step.text.length + JSON.stringify(step.toolCalls).length) / 4) };
    return {
      text: step.text,
      toolCalls: step.toolCalls,
      stopReason: step.toolCalls.length ? 'tool_use' : 'end_turn',
      usage,
      model: 'heuristic-v1',
      latencyMs: Date.now() - started,
    };
  }
}

// ---------- conversation parsing ----------

interface CallRecord { id: string; name: string; input: Record<string, unknown>; result: string | null; isError: boolean }

interface Conversation {
  prompt: string;
  promptLower: string;
  selectedTable: string | null;
  selectedSql: string | null;
  calls: CallRecord[];
  callCount: number;
}

function parseConversation(messages: ChatMessage[]): Conversation {
  const first = messages[0]?.content.find((p) => p.type === 'text');
  const prompt = first && first.type === 'text' ? first.text : '';
  const calls: CallRecord[] = [];
  const byId = new Map<string, CallRecord>();
  for (const m of messages) {
    for (const p of m.content) {
      if (p.type === 'tool_use') {
        const rec: CallRecord = { id: p.id, name: p.name, input: p.input, result: null, isError: false };
        calls.push(rec);
        byId.set(p.id, rec);
      } else if (p.type === 'tool_result') {
        const rec = byId.get(p.toolUseId);
        if (rec) { rec.result = p.content; rec.isError = !!p.isError; }
      }
    }
  }
  const tableMatch = /Selected table:\s*`?([\w."]+)`?/i.exec(prompt);
  const sqlMatch = /Selected SQL:\s*```sql\n([\s\S]*?)```/i.exec(prompt);
  return {
    prompt, promptLower: prompt.toLowerCase(),
    selectedTable: tableMatch ? tableMatch[1].replace(/"/g, '') : null,
    selectedSql: sqlMatch ? sqlMatch[1].trim() : null,
    calls, callCount: calls.length,
  };
}

function taskText(c: Conversation): string {
  // Only the task portion (before the context section) should drive intent detection.
  const idx = c.prompt.indexOf('## Context');
  return (idx > 0 ? c.prompt.slice(0, idx) : c.prompt).replace(/^#+\s.*$/gm, '').toLowerCase();
}

function parseJson<T>(s: string | null): T | null {
  if (!s) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}

interface ListedTable { schema: string; name: string; kind: string; columns: number; rows: number | null; references?: string[] }

// ---------- decision logic ----------

interface Step { text: string; toolCalls: ToolCall[] }

let counter = 0;
const call = (name: string, input: Record<string, unknown>): ToolCall => ({ id: `h_${Date.now().toString(36)}_${++counter}`, name, input });

function decide(c: Conversation, available: string[]): Step {
  const has = (n: string) => available.includes(n);
  const task = taskText(c);
  const listCall = c.calls.find((x) => x.name === 'list_tables');
  const describes = c.calls.filter((x) => x.name === 'describe_table');
  const described: TableInfo[] = describes.map((d) => parseJson<{ table: TableInfo }>(d.result)?.table).filter((t): t is TableInfo => !!t);

  const wantsExplain = !!c.selectedSql && /\b(slow|explain|performance|plan|optimi[sz]|why|index)/.test(task);
  const wantsSqlGen = /\b(show|list|find|get|count|which|how many|top|select|query|generate (a )?(sql|query))\b/.test(task) && !/\b(review|analy[sz]e|normali[sz]|improve|design|document)\b/.test(task);
  const wantsMigration = /\b(migration|add (a |an )?(column|field)|add .* column|create (a )?table)\b/.test(task);
  const wantsExecution = /\b(run|execute)\b/.test(task) || (/\b(show|list|count|how many)\b/.test(task) && !/don'?t (run|execute)|do not (run|execute)|without (running|executing)/.test(task));

  // Phase 0a: run the selected SQL when explicitly asked to execute it.
  if (c.selectedSql && /\b(run|execute)\b/.test(task) && !wantsExplain && has('run_sql')) {
    const ran = c.calls.find((x) => x.name === 'run_sql');
    if (!ran) return { text: 'Executing the selected SQL.', toolCalls: [call('run_sql', { sql: c.selectedSql, purpose: 'Execute the SQL selected by the user' })] };
    const res = parseJson<{ rowCount: number; affectedRows: number | null; columns: { name: string }[]; rows: unknown[][]; durationMs: number }>(ran.result);
    if (ran.isError || !res) return { text: `The statement was not executed: ${ran.result}`, toolCalls: [] };
    if (res.columns.length === 0) return { text: `Executed successfully in ${res.durationMs}ms. Affected rows: ${res.affectedRows ?? 0}.`, toolCalls: [] };
    const header = `| ${res.columns.map((col) => col.name).join(' | ')} |\n| ${res.columns.map(() => '---').join(' | ')} |`;
    const preview = res.rows.slice(0, 10).map((r) => `| ${r.map((v) => String(v ?? 'NULL')).join(' | ')} |`).join('\n');
    return { text: `Query returned ${res.rowCount} row${res.rowCount === 1 ? '' : 's'} in ${res.durationMs}ms.\n\n${header}\n${preview}`, toolCalls: [] };
  }

  // Phase 0b: EXPLAIN a selected query directly when asked about performance.
  if (wantsExplain && has('explain_sql')) {
    const explained = c.calls.find((x) => x.name === 'explain_sql');
    if (!explained) return { text: 'Inspecting the query plan for the selected SQL.', toolCalls: [call('explain_sql', { sql: c.selectedSql })] };
    if (!listCall) return { text: 'Listing tables to find the schema objects involved.', toolCalls: [call('list_tables', {})] };
  }

  // Phase 1: list tables.
  if (!listCall) return { text: 'Reading the database schema.', toolCalls: [call('list_tables', {})] };
  if (listCall.isError || !listCall.result) {
    return { text: `I could not read the schema: ${listCall.result ?? 'unknown error'}. Check the connection and retry.`, toolCalls: [] };
  }
  const listed = parseJson<{ tables: ListedTable[] }>(listCall.result)?.tables ?? [];

  // Phase 2: describe target tables. For data questions without a selected table, search the schema first so
  // column names (not only table names) can steer table selection.
  const searchCall = c.calls.find((x) => x.name === 'search_schema');
  if (describes.length === 0 && wantsSqlGen && !wantsExplain && !wantsMigration && !c.selectedTable && !searchCall && has('search_schema')) {
    const stems = searchTerms(task);
    if (stems.length) return { text: `Searching the schema for: ${stems.join(', ')}.`, toolCalls: [call('search_schema', { query: stems.join(' ') })] };
  }
  if (describes.length === 0 && has('describe_table')) {
    const targets = searchCall ? chooseFromSearch(searchCall, listed) : [];
    if (targets.length === 0) targets.push(...chooseTargets(c, task, listed));
    if (targets.length === 0) return { text: 'The database has no tables to analyze.', toolCalls: [] };
    return {
      text: `Inspecting ${targets.length} table${targets.length > 1 ? 's' : ''}: ${targets.map((t) => t.name).join(', ')}.`,
      toolCalls: targets.map((t) => call('describe_table', { table: `${t.schema}.${t.name}` })),
    };
  }

  // Phase 3: act on intent.
  const primary = described[0];
  if (wantsExplain) {
    const plan = c.calls.find((x) => x.name === 'explain_sql')?.result ?? '';
    const findings = lintTables(described, listed.map((t) => t.name));
    return { text: explainAnswer(c.selectedSql ?? '', plan, described, findings), toolCalls: [] };
  }

  if (wantsMigration && primary && has('create_artifact')) {
    const artifact = c.calls.find((x) => x.name === 'create_artifact');
    if (!artifact) {
      const migration = buildMigration(task, primary);
      return {
        text: `Drafting a migration for ${primary.name}. It is saved as an artifact and not executed.`,
        toolCalls: [call('create_artifact', { type: 'migration', title: migration.title, language: 'sql', content: migration.sql })],
      };
    }
    return { text: `Migration drafted as an artifact. Review it and run it through the SQL workspace (it requires approval because it changes schema).\n\n\`\`\`sql\n${String(artifact.input.content)}\n\`\`\``, toolCalls: [] };
  }

  if (wantsSqlGen && primary) {
    const sql = buildSelect(task, primary, described);
    const ran = c.calls.find((x) => x.name === 'run_sql');
    const saved = c.calls.find((x) => x.name === 'create_artifact');
    if (wantsExecution && has('run_sql') && !ran) {
      return { text: `Running the generated query against ${primary.name}.`, toolCalls: [call('run_sql', { sql })] };
    }
    if (!wantsExecution && has('create_artifact') && !saved) {
      return { text: 'Generated SQL saved as an artifact (not executed, as requested).', toolCalls: [call('create_artifact', { type: 'sql', title: `Query: ${primary.name}`, language: 'sql', content: sql })] };
    }
    if (ran) {
      const res = parseJson<{ rowCount: number; columns: { name: string }[]; rows: unknown[][]; error?: string }>(ran.result);
      if (ran.isError || !res) return { text: `The query failed: ${ran.result}\n\n\`\`\`sql\n${sql}\n\`\`\``, toolCalls: [] };
      const preview = res.rows.slice(0, 10).map((r) => `| ${r.map((v) => String(v ?? 'NULL')).join(' | ')} |`).join('\n');
      const header = `| ${res.columns.map((col) => col.name).join(' | ')} |\n| ${res.columns.map(() => '---').join(' | ')} |`;
      return { text: `Query returned ${res.rowCount} row${res.rowCount === 1 ? '' : 's'}.\n\n\`\`\`sql\n${sql}\n\`\`\`\n\n${header}\n${preview}`, toolCalls: [] };
    }
    return { text: `Generated SQL:\n\n\`\`\`sql\n${sql}\n\`\`\``, toolCalls: [] };
  }

  // Default: schema analysis.
  const findings = lintTables(described, listed.map((t) => t.name));
  const artifact = c.calls.find((x) => x.name === 'create_artifact');
  const isChat = /\bkind:\s*chat\b/i.test(c.prompt);
  if (!artifact && has('create_artifact') && !isChat) {
    const report = formatLintReport(described, findings);
    return {
      text: `Analysis complete: ${findings.length} finding${findings.length === 1 ? '' : 's'}. Saving the report as an artifact.`,
      toolCalls: [call('create_artifact', { type: 'analysis', title: `Schema analysis: ${described.map((t) => t.name).slice(0, 3).join(', ')}${described.length > 3 ? ` +${described.length - 3}` : ''}`, language: 'markdown', content: report })],
    };
  }
  return { text: summaryAnswer(c, described, findings, !!artifact), toolCalls: [] };
}

function chooseTargets(c: Conversation, task: string, listed: ListedTable[]): ListedTable[] {
  const tables = listed.filter((t) => t.kind === 'table');
  if (c.selectedTable) {
    const sel = c.selectedTable.toLowerCase();
    const hit = tables.find((t) => `${t.schema}.${t.name}`.toLowerCase() === sel || t.name.toLowerCase() === sel.split('.').pop());
    if (hit) return [hit];
  }
  const words = new Set(task.replace(/[^a-z0-9_\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
  const matched = tables.filter((t) => {
    const n = t.name.toLowerCase();
    const variants = new Set([n, n.replace(/s$/, ''), n.replace(/ies$/, 'y'), n.replace(/es$/, ''), n + 's', n + 'es']);
    for (const w of words) {
      if (variants.has(w) || variants.has(w.replace(/s$/, ''))) return true;
      if (n.includes('_') && n.split('_').some((part) => part === w || part + 's' === w)) return true;
    }
    return false;
  });
  if (matched.length) {
    const broad = /\b(schema|design|normali[sz]|review|relationship|related|improve|model)\b/.test(task);
    if (!broad) return matched.slice(0, 8);
    // Widen to tables that look related by naming (<singular>_id convention) so relationship-level findings are possible.
    const names = new Set(matched.map((t) => t.name.toLowerCase()));
    const related = tables.filter((t) => !names.has(t.name.toLowerCase()) && ([...names].some((n) => relatedByName(t.name, n)) || (t.references ?? []).some((r) => names.has(r.toLowerCase())) || matched.some((m) => (m.references ?? []).some((r) => r.toLowerCase() === t.name.toLowerCase()))));
    return [...matched, ...related].slice(0, 8);
  }
  return [...tables].sort((a, b) => (b.rows ?? 0) - (a.rows ?? 0)).slice(0, 8);
}

const STOP = new Set(['show', 'list', 'find', 'get', 'count', 'which', 'how', 'many', 'top', 'select', 'query', 'generate', 'sql', 'the', 'all', 'with', 'whose', 'their', 'that', 'this', 'than', 'greater', 'less', 'more', 'over', 'under', 'above', 'below', 'and', 'for', 'from', 'where', 'are', 'have', 'has', 'active', 'lakh', 'crore', 'total', 'run', 'execute', 'kind', 'chat', 'task', 'please', 'want', 'need', 'give']);

function stem(w: string): string {
  return w.replace(/(ments?|ings?|ions?|ies|ed|es|s)$/, (m) => (m === 'ies' ? 'y' : '')).replace(/y$/, '');
}

function searchTerms(task: string): string[] {
  const words = task.replace(/[^a-z0-9_\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w));
  return [...new Set(words.map(stem).filter((w) => w.length > 2))].slice(0, 5);
}

function chooseFromSearch(searchCall: CallRecord, listed: ListedTable[]): ListedTable[] {
  const res = parseJson<{ hits: { table: string; column?: string }[] }>(searchCall.result);
  if (!res) return [];
  const score = new Map<string, number>();
  for (const h of res.hits) score.set(h.table, (score.get(h.table) ?? 0) + (h.column ? 1 : 3));
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k.split('.').pop()!.toLowerCase());
  const pick = ranked.map((n) => listed.find((t) => t.name.toLowerCase() === n)).filter((t): t is ListedTable => !!t);
  return pick.slice(0, 3);
}

function relatedByName(candidate: string, target: string): boolean {
  const singular = target.replace(/ies$/, 'y').replace(/s$/, '');
  return new RegExp(`(^|_)${singular}(_|$)`).test(candidate.toLowerCase());
}

function q(name: string): string {
  return /^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name}"`;
}

function buildSelect(task: string, t: TableInfo, all: TableInfo[]): string {
  const ref = t.schema === 'main' ? q(t.name) : `${q(t.schema)}.${q(t.name)}`;
  if (/\b(count|how many)\b/.test(task)) return `SELECT COUNT(*) AS total\nFROM ${ref};`;
  const limitMatch = /\btop (\d+)|\bfirst (\d+)|\blimit (\d+)/.exec(task);
  const limit = Number(limitMatch?.[1] ?? limitMatch?.[2] ?? limitMatch?.[3] ?? 50);
  const joins: string[] = [];
  const cols: string[] = t.columns.slice(0, 12).map((c) => `${q(t.name)}.${q(c.name)}`);
  // Join a second mentioned table through a foreign key when the task names it.
  for (const other of all.slice(1, 3)) {
    const fk = t.foreignKeys.find((f) => f.refTable === other.name) ?? other.foreignKeys.find((f) => f.refTable === t.name);
    if (!fk) continue;
    const fromOther = fk.refTable === t.name;
    const on = fk.columns.map((col, i) => fromOther
      ? `${q(other.name)}.${q(col)} = ${q(t.name)}.${q(fk.refColumns[i])}`
      : `${q(t.name)}.${q(col)} = ${q(other.name)}.${q(fk.refColumns[i])}`).join(' AND ');
    joins.push(`JOIN ${other.schema === 'main' ? q(other.name) : `${q(other.schema)}.${q(other.name)}`} ON ${on}`);
    cols.push(...other.columns.filter((c) => !c.isPrimaryKey).slice(0, 3).map((c) => `${q(other.name)}.${q(c.name)}`));
  }
  const where: string[] = [];
  const gt = /(?:greater than|more than|above|over|>)\s*([\d.,]+)\s*(lakh|lac|crore|k|million)?/.exec(task);
  if (gt) {
    const mult = { lakh: 1e5, lac: 1e5, crore: 1e7, k: 1e3, million: 1e6 }[gt[2] ?? ''] ?? 1;
    const value = Number(gt[1].replace(/,/g, '')) * mult;
    const numeric = t.columns.find((c) => /(amount|total|value|balance|price|invest|salary|qty|quantity)/i.test(c.name) && (/(int|num|dec|real|double|float|money)/i.test(c.dataType) || /^(any)?$/i.test(c.dataType) || /_paise$/i.test(c.name)));
    if (numeric) where.push(`${q(t.name)}.${q(numeric.name)} > ${/_paise$/i.test(numeric.name) ? value * 100 : value}`);
  }
  if (/\bactive\b/.test(task)) {
    const status = [t, ...all.slice(1, 3)].flatMap((x) => x.columns.filter((c) => /(status|is_active|active)/i.test(c.name)).map((c) => ({ x, c })))[0];
    if (status) where.push(/^is_|active$/.test(status.c.name) && /bool|int/i.test(status.c.dataType) ? `${q(status.x.name)}.${q(status.c.name)} = 1` : `${q(status.x.name)}.${q(status.c.name)} = 'ACTIVE'`);
  }
  return `SELECT ${cols.join(',\n       ')}\nFROM ${ref}${joins.length ? '\n' + joins.join('\n') : ''}${where.length ? '\nWHERE ' + where.join('\n  AND ') : ''}\nLIMIT ${limit};`;
}

function buildMigration(task: string, t: TableInfo): { title: string; sql: string } {
  const ref = t.schema === 'main' ? q(t.name) : `${q(t.schema)}.${q(t.name)}`;
  const colMatch = /add (?:a |an )?(?:column |field )?(?:called |named )?`?([a-z][a-z0-9_]*)`?/.exec(task) ?? /add (?:an? )?(external (?:uuid|id)|uuid|created_at|updated_at|deleted_at|version)/.exec(task);
  let col = (colMatch?.[1] ?? 'external_id').replace(/\s+/g, '_');
  if (col === 'external_uuid' || col === 'uuid' || /external uuid/.test(task)) col = 'external_id';
  const isPg = t.schema !== 'main';
  const type = /uuid|external/.test(col) ? (isPg ? 'uuid' : 'TEXT') : /_at$/.test(col) ? (isPg ? 'timestamptz' : 'TEXT') : /version|count|_id$/.test(col) ? (isPg ? 'bigint' : 'INTEGER') : (isPg ? 'text' : 'TEXT');
  const dflt = /uuid|external/.test(col) && isPg ? ' DEFAULT gen_random_uuid()' : /_at$/.test(col) ? (isPg ? ' DEFAULT now()' : " DEFAULT (datetime('now'))") : '';
  const lines = [
    `-- Migration: add ${col} to ${t.name}`,
    `-- Generated by SchemaForge heuristic agent. Review before applying.`,
    `ALTER TABLE ${ref} ADD COLUMN ${q(col)} ${type}${dflt};`,
  ];
  if (/uuid|external/.test(col)) {
    lines.push(`CREATE UNIQUE INDEX ${q(`ux_${t.name}_${col}`)} ON ${ref} (${q(col)});`);
    if (isPg && !dflt) lines.push(`-- Backfill: UPDATE ${ref} SET ${q(col)} = gen_random_uuid() WHERE ${q(col)} IS NULL;`);
  }
  lines.push('', `-- Rollback:`, `-- DROP INDEX IF EXISTS ${q(`ux_${t.name}_${col}`)};`, `-- ALTER TABLE ${ref} DROP COLUMN ${q(col)};`);
  return { title: `Migration: add ${col} to ${t.name}`, sql: lines.join('\n') };
}

function explainAnswer(sql: string, plan: string, tables: TableInfo[], findings: LintFinding[]): string {
  // Alias → table map from FROM/JOIN clauses so plan lines like "SCAN s" can be attributed.
  const aliases = new Map<string, string>();
  const fromRe = /\b(?:FROM|JOIN)\s+("?[\w.]+"?)(?:\s+(?:AS\s+)?(?!ON\b|WHERE\b|JOIN\b|LEFT\b|RIGHT\b|INNER\b|GROUP\b|ORDER\b|LIMIT\b)(\w+))?/gi;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(sql))) {
    const table = m[1].replace(/"/g, '').split('.').pop()!;
    aliases.set(table.toLowerCase(), table);
    if (m[2]) aliases.set(m[2].toLowerCase(), table);
  }
  const resolve = (name: string) => aliases.get(name.toLowerCase()) ?? name;
  const scans: string[] = [];
  const seq = /Seq Scan on (\w+)/g;
  while ((m = seq.exec(plan))) scans.push(resolve(m[1]));
  for (const line of plan.split('\n')) {
    const s = /\bSCAN (\w+)/.exec(line);
    if (s && !/USING (COVERING )?INDEX/i.test(line) && !/CONSTANT ROW/i.test(line)) scans.push(resolve(s[1]));
  }
  const scanned = [...new Set(scans)];
  // Columns used in WHERE/JOIN predicates on scanned tables → index candidates.
  const predicates: { table: string; column: string }[] = [];
  const predRe = /(\w+)\.(\w+)\s*(?:=|<>|!=|<|>|<=|>=|\bIN\b|\bLIKE\b|\bBETWEEN\b)/gi;
  while ((m = predRe.exec(sql))) {
    const table = resolve(m[1]);
    if (scanned.includes(table) && !predicates.some((p) => p.table === table && p.column === m![2])) predicates.push({ table, column: m[2] });
  }
  const out: string[] = ['## Query plan', '```', plan || '(no plan available)', '```', ''];
  if (scanned.length) {
    out.push(`## Observations`, `- Full table scans on: **${scanned.join(', ')}**. If these tables are large, an index on the filtered/joined columns would let the planner avoid the scan.`);
    for (const p of predicates) {
      const t = tables.find((x) => x.name.toLowerCase() === p.table.toLowerCase());
      const covered = t?.indexes.some((i) => i.columns[0]?.toLowerCase() === p.column.toLowerCase()) || t?.primaryKey[0]?.toLowerCase() === p.column.toLowerCase();
      if (!covered) out.push(`- \`${p.table}.${p.column}\` is used in a predicate but has no leading index:\n  \`CREATE INDEX ix_${p.table}_${p.column} ON ${p.table} (${p.column});\``);
    }
    if (/TEMP B-TREE/i.test(plan)) out.push('- The plan builds temporary B-trees for GROUP BY/ORDER BY; an index matching the grouping/order columns can remove the sort.');
  } else {
    out.push('## Observations', '- The plan does not show full table scans; the query already uses indexes where available.');
  }
  const idxFindings = findings.filter((f) => f.code === 'FK_NOT_INDEXED');
  if (idxFindings.length) out.push(`- Foreign-key columns without an index: ${idxFindings.map((f) => `\`${f.table}.${f.column}\``).join(', ')}.`);
  out.push('', '## Suggested next steps', '- Run `EXPLAIN ANALYZE` on a representative dataset to confirm actual timings (estimates above are planner estimates only).', '- Add indexes for filtered/joined columns only if the table is large enough for the planner to prefer them.');
  return out.join('\n');
}

function summaryAnswer(c: Conversation, tables: TableInfo[], findings: LintFinding[], savedArtifact: boolean): string {
  const bySeverity = { high: findings.filter((f) => f.severity === 'high'), medium: findings.filter((f) => f.severity === 'medium'), low: findings.filter((f) => f.severity === 'low') };
  const lines = [`Reviewed ${tables.length} table${tables.length === 1 ? '' : 's'} (${tables.map((t) => t.name).join(', ')}).`, ''];
  if (findings.length === 0) lines.push('No structural issues found: every table has a primary key, foreign keys are indexed and naming is consistent.');
  else {
    lines.push(`**Findings:** ${bySeverity.high.length} high, ${bySeverity.medium.length} medium, ${bySeverity.low.length} low.`, '');
    for (const f of findings.slice(0, 12)) lines.push(`- **[${f.severity}] ${f.table}${f.column ? '.' + f.column : ''}** — ${f.message}${f.suggestion ? ` *${f.suggestion}*` : ''}`);
    if (findings.length > 12) lines.push(`- …and ${findings.length - 12} more in the full report.`);
  }
  if (savedArtifact) lines.push('', 'The full report is saved as an analysis artifact.');
  if (/\bindex/.test(taskText(c)) && tables.length === 1) {
    const t = tables[0];
    lines.push('', `**Indexes on ${t.name}:** ${t.indexes.length ? t.indexes.map((i) => `${i.name} (${i.columns.join(', ')})${i.unique ? ' unique' : ''}`).join('; ') : 'none besides the primary key'}.`);
  }
  return lines.join('\n');
}
