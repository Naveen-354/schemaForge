import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Agent, AgentRun, Artifact, ArtifactType, Project, SqlRisk, Task, TableInfo } from '@schemaforge/shared';
import { tableKey } from '@schemaforge/shared';
import type { ToolSpec } from '../ai/types.js';
import { artifacts, connections, knowledge } from '../store/repos.js';
import { executeSql, explainSql, findTable, getSnapshot } from '../dbs/manager.js';
import { classifySql } from '../sql/classify.js';
import { generateTableDdl } from '../sql/ddl.js';
import { searchKnowledge } from './knowledge.js';

const execFileAsync = promisify(execFile);

export type ToolRisk = 'read' | 'write' | 'exec' | 'sql';

export interface ToolContext {
  workspaceId: string;
  project: Project;
  task: Task;
  agent: Agent;
  run: AgentRun;
  connectionId: string | null;
  /** Called by tools to surface progress in the activity timeline. */
  log(message: string, data?: Record<string, unknown>): void;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
  summary: string;
  artifactId?: string;
}

export interface RiskAssessment {
  /** Which permission bucket governs this call. */
  sqlRisk?: SqlRisk;
  summary: string;
  detail: string;
  risk: string;
}

export interface ToolDefinition extends ToolSpec {
  risk: ToolRisk;
  /** Returns a description of what the call would do, for approval prompts. */
  assess(input: Record<string, unknown>, ctx: ToolContext): RiskAssessment;
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

const MAX_TOOL_OUTPUT = 24_000;

function clip(s: string, max = MAX_TOOL_OUTPUT): string {
  return s.length > max ? s.slice(0, max) + `\n…[truncated ${s.length - max} chars]` : s;
}

function str(v: unknown, fallback = ''): string {
  return v == null ? fallback : String(v);
}

function requireConnection(ctx: ToolContext, input: Record<string, unknown>): string {
  const id = str(input.connectionId) || ctx.connectionId;
  if (!id) throw new Error('No database connection selected for this task. Set task.connectionId or pass connectionId.');
  const conn = connections.get(id);
  if (!conn) throw new Error(`Connection ${id} not found`);
  if (conn.projectId !== ctx.project.id) throw new Error('Connection belongs to a different project');
  return id;
}

function resolveProjectPath(ctx: ToolContext, rel: unknown): string {
  const root = ctx.project.rootPath;
  if (!root) throw new Error('Project has no root path configured; filesystem tools are unavailable.');
  const abs = path.resolve(root, str(rel, '.'));
  const rootAbs = path.resolve(root);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) throw new Error('Path escapes the project root');
  return abs;
}

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.next', '.venv', 'venv', '__pycache__', 'data']);

function walk(dir: string, root: string, out: string[], depth: number, maxEntries: number): void {
  if (out.length >= maxEntries || depth < 0) return;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (out.length >= maxEntries) return;
    if (IGNORED_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    const rel = path.relative(root, full).split(path.sep).join('/');
    if (e.isDirectory()) { out.push(rel + '/'); walk(full, root, out, depth - 1, maxEntries); }
    else out.push(rel);
  }
}

function tableSummary(t: TableInfo) {
  return { schema: t.schema, name: t.name, kind: t.kind, columns: t.columns.length, rows: t.rowEstimate, references: [...new Set(t.foreignKeys.map((fk) => fk.refTable))] };
}

function trimTable(t: TableInfo, engine: 'postgres' | 'sqlite') {
  return {
    table: {
      ...t,
      columns: t.columns.map((c) => ({ name: c.name, dataType: c.dataType, nullable: c.nullable, defaultValue: c.defaultValue, isPrimaryKey: c.isPrimaryKey, comment: c.comment })),
      definition: t.kind === 'table' ? null : t.definition,
    },
    ddl: generateTableDdl(t, engine),
  };
}

export const TOOLS: ToolDefinition[] = [
  {
    name: 'list_tables',
    description: 'List tables and views in the task database with column counts and row estimates. Call this before guessing table names.',
    inputSchema: { type: 'object', properties: { connectionId: { type: 'string', description: 'Optional connection id; defaults to the task connection.' }, schema: { type: 'string' } }, additionalProperties: false },
    risk: 'read',
    assess: () => ({ summary: 'List tables', detail: '', risk: 'read-only metadata' }),
    async execute(input, ctx) {
      const id = requireConnection(ctx, input);
      const snap = await getSnapshot(id);
      const conn = connections.get(id)!;
      const tables = snap.tables.filter((t) => !input.schema || t.schema === input.schema).map(tableSummary);
      return { content: JSON.stringify({ connection: { id, name: conn.name, engine: conn.engine }, schemas: snap.schemas, tables }), summary: `${tables.length} tables` };
    },
  },
  {
    name: 'describe_table',
    description: 'Get full metadata for one table: columns, types, primary key, foreign keys, indexes, constraints and generated DDL.',
    inputSchema: { type: 'object', properties: { table: { type: 'string', description: 'Table name, optionally schema-qualified (schema.table).' }, connectionId: { type: 'string' } }, required: ['table'], additionalProperties: false },
    risk: 'read',
    assess: (i) => ({ summary: `Describe ${i.table}`, detail: '', risk: 'read-only metadata' }),
    async execute(input, ctx) {
      const id = requireConnection(ctx, input);
      const snap = await getSnapshot(id);
      const t = findTable(snap, str(input.table));
      if (!t) return { content: `Table "${input.table}" not found. Available: ${snap.tables.map((x) => tableKey(x.schema, x.name)).join(', ')}`, isError: true, summary: 'not found' };
      const referencedBy = snap.tables.filter((x) => x.foreignKeys.some((fk) => fk.refTable === t.name && fk.refSchema === t.schema)).map((x) => ({ table: tableKey(x.schema, x.name), via: x.foreignKeys.filter((fk) => fk.refTable === t.name).map((fk) => fk.columns.join(',')) }));
      return { content: JSON.stringify({ ...trimTable(t, snap.engine), referencedBy }), summary: `${t.name}: ${t.columns.length} columns, ${t.foreignKeys.length} FKs, ${t.indexes.length} indexes` };
    },
  },
  {
    name: 'search_schema',
    description: 'Search table and column names (and comments) across the database for a keyword.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, connectionId: { type: 'string' } }, required: ['query'], additionalProperties: false },
    risk: 'read',
    assess: (i) => ({ summary: `Search schema for "${i.query}"`, detail: '', risk: 'read-only metadata' }),
    async execute(input, ctx) {
      const id = requireConnection(ctx, input);
      const snap = await getSnapshot(id);
      const q = str(input.query).toLowerCase();
      const terms = q.split(/\s+/).filter(Boolean);
      const hits: { table: string; column?: string; type?: string; match: string }[] = [];
      for (const t of snap.tables) {
        const key = tableKey(t.schema, t.name);
        if (terms.some((term) => t.name.toLowerCase().includes(term) || (t.comment ?? '').toLowerCase().includes(term))) hits.push({ table: key, match: 'table name' });
        for (const c of t.columns) {
          if (terms.some((term) => c.name.toLowerCase().includes(term) || (c.comment ?? '').toLowerCase().includes(term))) hits.push({ table: key, column: c.name, type: c.dataType, match: 'column' });
        }
      }
      return { content: JSON.stringify({ query: q, hits: hits.slice(0, 200) }), summary: `${hits.length} hits` };
    },
  },
  {
    name: 'get_relationships',
    description: 'Get foreign-key relationships for a table in both directions (what it references, what references it).',
    inputSchema: { type: 'object', properties: { table: { type: 'string' }, connectionId: { type: 'string' } }, required: ['table'], additionalProperties: false },
    risk: 'read',
    assess: (i) => ({ summary: `Relationships of ${i.table}`, detail: '', risk: 'read-only metadata' }),
    async execute(input, ctx) {
      const id = requireConnection(ctx, input);
      const snap = await getSnapshot(id);
      const t = findTable(snap, str(input.table));
      if (!t) return { content: `Table "${input.table}" not found`, isError: true, summary: 'not found' };
      const outgoing = t.foreignKeys.map((fk) => ({ columns: fk.columns, references: tableKey(fk.refSchema, fk.refTable), refColumns: fk.refColumns, onDelete: fk.onDelete }));
      const incoming = snap.tables.flatMap((x) => x.foreignKeys.filter((fk) => fk.refTable === t.name && fk.refSchema === t.schema).map((fk) => ({ from: tableKey(x.schema, x.name), columns: fk.columns, refColumns: fk.refColumns, onDelete: fk.onDelete })));
      return { content: JSON.stringify({ table: tableKey(t.schema, t.name), outgoing, incoming }), summary: `${outgoing.length} outgoing, ${incoming.length} incoming` };
    },
  },
  {
    name: 'run_sql',
    description: 'Execute SQL against the task database. SELECT/EXPLAIN run freely; INSERT/UPDATE/DELETE/DDL need permission and may require user approval. Results are capped at 200 rows for the model.',
    inputSchema: { type: 'object', properties: { sql: { type: 'string' }, connectionId: { type: 'string' }, dryRun: { type: 'boolean', description: 'Run inside a transaction that is rolled back.' }, purpose: { type: 'string', description: 'One-line reason shown to the user when approval is required.' } }, required: ['sql'], additionalProperties: false },
    risk: 'sql',
    assess: (input) => {
      const cls = classifySql(str(input.sql));
      return { sqlRisk: cls.risk, summary: `${cls.statementType}${input.purpose ? ` — ${input.purpose}` : ''}`, detail: str(input.sql), risk: cls.risk === 'safe' ? 'read-only' : `${cls.risk}: ${cls.reasons.join('; ')}` };
    },
    async execute(input, ctx) {
      const id = requireConnection(ctx, input);
      const sql = str(input.sql);
      const out = await executeSql(id, sql, { actorType: 'agent', actorId: ctx.agent.id, taskId: ctx.task.id, runId: ctx.run.id, dryRun: !!input.dryRun, maxRows: 200 });
      if (out.error) return { content: `SQL error: ${out.error}`, isError: true, summary: `error: ${out.error.slice(0, 80)}` };
      const r = out.result!;
      const payload = { columns: r.columns, rows: r.rows.slice(0, 200), rowCount: r.rowCount, affectedRows: r.affectedRows, truncated: r.truncated || r.rows.length > 200, durationMs: r.durationMs, command: r.command, dryRun: !!input.dryRun };
      return { content: clip(JSON.stringify(payload)), summary: `${r.affectedRows ?? r.rowCount} rows · ${r.durationMs}ms` };
    },
  },
  {
    name: 'explain_sql',
    description: 'Return the database query plan for a statement (EXPLAIN). Set analyze=true to actually run a read-only query and get real timings.',
    inputSchema: { type: 'object', properties: { sql: { type: 'string' }, analyze: { type: 'boolean' }, connectionId: { type: 'string' } }, required: ['sql'], additionalProperties: false },
    risk: 'read',
    assess: (i) => ({ summary: `EXPLAIN${i.analyze ? ' ANALYZE' : ''}`, detail: str(i.sql), risk: 'read-only' }),
    async execute(input, ctx) {
      const id = requireConnection(ctx, input);
      const plan = await explainSql(id, str(input.sql), !!input.analyze);
      return { content: clip(plan), summary: `${plan.split('\n').length} plan lines` };
    },
  },
  {
    name: 'create_artifact',
    description: 'Save a durable artifact (SQL, migration, analysis, document, code, report…) for the user and other agents. Use this for any deliverable instead of only replying with text.',
    inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ['sql', 'migration', 'analysis', 'document', 'diagram', 'code', 'test-result', 'research', 'report', 'other'] }, title: { type: 'string' }, content: { type: 'string' }, language: { type: 'string', description: 'sql, markdown, typescript, json…' } }, required: ['type', 'title', 'content'], additionalProperties: false },
    risk: 'read',
    assess: (i) => ({ summary: `Create ${i.type} artifact "${i.title}"`, detail: '', risk: 'stores data in SchemaForge only' }),
    async execute(input, ctx) {
      const a: Artifact = artifacts.create({
        projectId: ctx.project.id, taskId: ctx.task.id, agentId: ctx.agent.id, runId: ctx.run.id,
        type: (str(input.type, 'other') as ArtifactType), title: str(input.title, 'Untitled'), content: str(input.content), language: input.language ? str(input.language) : null, metadata: {},
      });
      return { content: JSON.stringify({ artifactId: a.id, title: a.title, type: a.type }), summary: `${a.type}: ${a.title}`, artifactId: a.id };
    },
  },
  {
    name: 'list_artifacts',
    description: 'List artifacts in this project (optionally filtered by type or task), newest first.',
    inputSchema: { type: 'object', properties: { type: { type: 'string' }, taskId: { type: 'string' }, limit: { type: 'number' } }, additionalProperties: false },
    risk: 'read',
    assess: () => ({ summary: 'List artifacts', detail: '', risk: 'read-only' }),
    async execute(input, ctx) {
      const list = artifacts.list({ projectId: ctx.project.id, type: input.type ? str(input.type) : undefined, taskId: input.taskId ? str(input.taskId) : undefined, limit: Number(input.limit ?? 50) });
      return { content: JSON.stringify(list.map((a) => ({ id: a.id, type: a.type, title: a.title, taskId: a.taskId, agentId: a.agentId, createdAt: a.createdAt, size: a.content.length }))), summary: `${list.length} artifacts` };
    },
  },
  {
    name: 'read_artifact',
    description: 'Read the full content of an artifact by id.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    risk: 'read',
    assess: (i) => ({ summary: `Read artifact ${i.id}`, detail: '', risk: 'read-only' }),
    async execute(input, ctx) {
      const a = artifacts.get(str(input.id));
      if (!a || a.projectId !== ctx.project.id) return { content: 'Artifact not found', isError: true, summary: 'not found' };
      return { content: clip(JSON.stringify({ id: a.id, type: a.type, title: a.title, language: a.language, content: a.content })), summary: a.title };
    },
  },
  {
    name: 'search_knowledge',
    description: 'Search project knowledge (conventions, architecture decisions, business rules, prior findings).',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'], additionalProperties: false },
    risk: 'read',
    assess: (i) => ({ summary: `Search knowledge for "${i.query}"`, detail: '', risk: 'read-only' }),
    async execute(input, ctx) {
      const hits = searchKnowledge(ctx.project.id, str(input.query), Number(input.limit ?? 8), ctx.agent.id);
      return { content: JSON.stringify(hits.map((k) => ({ id: k.id, category: k.category, title: k.title, content: k.content, tags: k.tags, scope: k.scope }))), summary: `${hits.length} entries` };
    },
  },
  {
    name: 'save_knowledge',
    description: 'Persist a reusable fact for this project (convention, decision, business rule, known problem). Keep it short and specific.',
    inputSchema: { type: 'object', properties: { category: { type: 'string', description: 'e.g. convention, decision, relationship, business-rule, known-problem, research' }, title: { type: 'string' }, content: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, scope: { type: 'string', enum: ['project', 'agent'] } }, required: ['category', 'title', 'content'], additionalProperties: false },
    risk: 'read',
    assess: (i) => ({ summary: `Save knowledge "${i.title}"`, detail: str(i.content), risk: 'stores data in SchemaForge only' }),
    async execute(input, ctx) {
      const scope = input.scope === 'agent' ? 'agent' : 'project';
      const k = knowledge.create({ projectId: ctx.project.id, scope, agentId: scope === 'agent' ? ctx.agent.id : null, category: str(input.category, 'note'), title: str(input.title), content: str(input.content), tags: Array.isArray(input.tags) ? input.tags.map(String) : [] });
      ctx.log(`Saved knowledge: ${k.title}`, { knowledgeId: k.id });
      return { content: JSON.stringify({ id: k.id }), summary: k.title };
    },
  },
  {
    name: 'list_files',
    description: 'List files under the project root (recursively, limited). Requires the project to have a root path.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, depth: { type: 'number' } }, additionalProperties: false },
    risk: 'read',
    assess: (i) => ({ summary: `List files ${i.path ?? '.'}`, detail: '', risk: 'read-only filesystem' }),
    async execute(input, ctx) {
      const abs = resolveProjectPath(ctx, input.path);
      const out: string[] = [];
      walk(abs, path.resolve(ctx.project.rootPath!), out, Number(input.depth ?? 3), 800);
      return { content: out.join('\n') || '(empty)', summary: `${out.length} entries` };
    },
  },
  {
    name: 'read_file',
    description: 'Read a text file from the project root.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, startLine: { type: 'number' }, endLine: { type: 'number' } }, required: ['path'], additionalProperties: false },
    risk: 'read',
    assess: (i) => ({ summary: `Read ${i.path}`, detail: '', risk: 'read-only filesystem' }),
    async execute(input, ctx) {
      const abs = resolveProjectPath(ctx, input.path);
      const stat = fs.statSync(abs);
      if (stat.size > 2_000_000) return { content: 'File too large (>2MB)', isError: true, summary: 'too large' };
      let text = fs.readFileSync(abs, 'utf8');
      if (input.startLine || input.endLine) {
        const lines = text.split('\n');
        text = lines.slice(Math.max(0, Number(input.startLine ?? 1) - 1), Number(input.endLine ?? lines.length)).join('\n');
      }
      return { content: clip(text), summary: `${stat.size} bytes` };
    },
  },
  {
    name: 'search_files',
    description: 'Search file contents under the project root for a regular expression (case-insensitive). Returns file:line matches.',
    inputSchema: { type: 'object', properties: { pattern: { type: 'string' }, glob: { type: 'string', description: 'File extension filter like .ts or .java' }, limit: { type: 'number' } }, required: ['pattern'], additionalProperties: false },
    risk: 'read',
    assess: (i) => ({ summary: `Search files for /${i.pattern}/`, detail: '', risk: 'read-only filesystem' }),
    async execute(input, ctx) {
      const root = path.resolve(resolveProjectPath(ctx, '.'));
      const files: string[] = [];
      walk(root, root, files, 8, 5000);
      const re = new RegExp(str(input.pattern), 'i');
      const ext = input.glob ? str(input.glob).replace(/^\*/, '') : null;
      const limit = Number(input.limit ?? 100);
      const hits: string[] = [];
      for (const rel of files) {
        if (rel.endsWith('/') || (ext && !rel.endsWith(ext))) continue;
        const abs = path.join(root, rel);
        let text: string;
        try { if (fs.statSync(abs).size > 1_000_000) continue; text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
        if (text.includes(' ')) continue;
        const lines = text.split('\n');
        for (let i = 0; i < lines.length && hits.length < limit; i++) if (re.test(lines[i])) hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
        if (hits.length >= limit) break;
      }
      return { content: hits.join('\n') || '(no matches)', summary: `${hits.length} matches` };
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a text file under the project root. Requires write permission; usually needs user approval.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false },
    risk: 'write',
    assess: (i) => ({ summary: `Write file ${i.path}`, detail: str(i.content).slice(0, 4000), risk: 'modifies project files' }),
    async execute(input, ctx) {
      const abs = resolveProjectPath(ctx, input.path);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, str(input.content), 'utf8');
      ctx.log(`Wrote ${input.path}`, { path: input.path, bytes: str(input.content).length });
      return { content: `Wrote ${str(input.content).length} bytes to ${input.path}`, summary: `wrote ${input.path}` };
    },
  },
  {
    name: 'git_status',
    description: 'Show git status and current branch for the project repository.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    risk: 'read',
    assess: () => ({ summary: 'git status', detail: '', risk: 'read-only' }),
    async execute(_input, ctx) {
      const cwd = resolveProjectPath(ctx, '.');
      const { stdout } = await execFileAsync('git', ['status', '--short', '--branch'], { cwd, timeout: 15_000 });
      return { content: clip(stdout) || '(clean)', summary: `${stdout.split('\n').filter(Boolean).length - 1} changed files` };
    },
  },
  {
    name: 'git_diff',
    description: 'Show the git diff (working tree vs HEAD), optionally for one path.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, staged: { type: 'boolean' } }, additionalProperties: false },
    risk: 'read',
    assess: (i) => ({ summary: `git diff ${i.path ?? ''}`, detail: '', risk: 'read-only' }),
    async execute(input, ctx) {
      const cwd = resolveProjectPath(ctx, '.');
      const args = ['diff', ...(input.staged ? ['--cached'] : []), ...(input.path ? ['--', str(input.path)] : [])];
      const { stdout } = await execFileAsync('git', args, { cwd, timeout: 15_000, maxBuffer: 8_000_000 });
      return { content: clip(stdout) || '(no changes)', summary: `${stdout.split('\n').length} lines` };
    },
  },
  {
    name: 'git_log',
    description: 'Show recent commits, optionally filtered to a path.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' }, path: { type: 'string' } }, additionalProperties: false },
    risk: 'read',
    assess: () => ({ summary: 'git log', detail: '', risk: 'read-only' }),
    async execute(input, ctx) {
      const cwd = resolveProjectPath(ctx, '.');
      const args = ['log', `-n${Number(input.limit ?? 20)}`, '--pretty=format:%h %ad %an %s', '--date=short', ...(input.path ? ['--', str(input.path)] : [])];
      const { stdout } = await execFileAsync('git', args, { cwd, timeout: 15_000 });
      return { content: clip(stdout) || '(no commits)', summary: `${stdout.split('\n').length} commits` };
    },
  },
  {
    name: 'run_command',
    description: 'Run a shell command inside the project root (tests, builds, scripts). Always requires user approval unless the agent is explicitly trusted.',
    inputSchema: { type: 'object', properties: { command: { type: 'string' }, timeoutSec: { type: 'number' } }, required: ['command'], additionalProperties: false },
    risk: 'exec',
    assess: (i) => ({ summary: `Run command: ${str(i.command).slice(0, 120)}`, detail: str(i.command), risk: 'executes arbitrary command in project root' }),
    async execute(input, ctx) {
      const cwd = resolveProjectPath(ctx, '.');
      const timeout = Math.min(600, Number(input.timeoutSec ?? 120)) * 1000;
      const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
      const args = process.platform === 'win32' ? ['/d', '/s', '/c', str(input.command)] : ['-c', str(input.command)];
      try {
        const { stdout, stderr } = await execFileAsync(shell, args, { cwd, timeout, maxBuffer: 8_000_000 });
        return { content: clip([stdout, stderr].filter(Boolean).join('\n--- stderr ---\n')), summary: 'exit 0' };
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string; code?: number; message: string };
        return { content: clip(`exit ${err.code ?? '?'}\n${err.stdout ?? ''}\n${err.stderr ?? err.message}`), isError: true, summary: `exit ${err.code ?? 'error'}` };
      }
    },
  },
];

export const toolMap = new Map(TOOLS.map((t) => [t.name, t]));

export function toolSpecs(names?: string[]): ToolSpec[] {
  return TOOLS.filter((t) => !names || names.includes(t.name)).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}
