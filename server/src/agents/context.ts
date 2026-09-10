import type { Agent, Project, Task } from '@schemaforge/shared';
import { tableKey } from '@schemaforge/shared';
import { artifacts, connections, tasks as taskRepo } from '../store/repos.js';
import { findTable, getSnapshot } from '../dbs/manager.js';
import { generateTableDdl } from '../sql/ddl.js';
import { searchKnowledge } from './knowledge.js';
import { TOOLS } from './tools.js';

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + `\n…[truncated]` : s);

export function buildSystemPrompt(agent: Agent, project: Project): string {
  const parts: string[] = [];
  parts.push(`You are "${agent.name}", a ${agent.role} agent inside SchemaForge, a database engineering workspace.`);
  parts.push(`You work on tasks by calling tools. Never guess database structure: use list_tables/describe_table/search_schema first. Use SQL tools for data questions. Deliver results as artifacts (create_artifact) when they are reusable (SQL, migrations, analyses, reports) and finish with a concise summary for the user. Do not execute destructive SQL unless the task explicitly asks for it; the system will ask the user for approval on risky actions and may deny them, in which case explain what you would have done instead. Keep tool calls purposeful; batch independent calls. When the task is a question, answer it directly and briefly.`);
  if (agent.instructions.trim()) parts.push(`## Agent instructions\n${agent.instructions.trim()}`);
  if (project.instructions.trim()) parts.push(`## Project instructions (${project.name})\n${project.instructions.trim()}`);
  parts.push(`## Tools available\n${TOOLS.map((t) => `- ${t.name}: ${t.description.split('.')[0]}.`).join('\n')}`);
  return parts.join('\n\n');
}

/** Build the first user message with selectively chosen context. */
export async function buildTaskPrompt(task: Task, project: Project, agent: Agent): Promise<string> {
  const parts: string[] = [];
  parts.push(`## Task\n${task.title}${task.description.trim() ? `\n\n${task.description.trim()}` : ''}`);

  const ctx: string[] = [];
  ctx.push(`Project: ${project.name}${project.description ? ` — ${project.description}` : ''}`);
  if (task.context.kind === 'chat') ctx.push('kind: chat (answer directly; only create artifacts for substantial deliverables)');
  const conns = connections.list(project.id);
  if (task.connectionId) {
    const c = conns.find((x) => x.id === task.connectionId);
    if (c) ctx.push(`Database connection: ${c.name} (${c.engine}, database "${c.database}"${c.readOnly ? ', read-only' : ''}) id=${c.id}`);
  } else if (conns.length) {
    ctx.push(`Available database connections (pass connectionId to tools): ${conns.map((c) => `${c.name} [${c.engine}] id=${c.id}`).join('; ')}`);
  }
  if (task.context.table && task.connectionId) {
    try {
      const snap = await getSnapshot(task.connectionId);
      const t = findTable(snap, tableKey(task.context.table.schema, task.context.table.name));
      if (t) {
        ctx.push(`Selected table: \`${tableKey(t.schema, t.name)}\``);
        ctx.push(`Selected table definition:\n\`\`\`sql\n${clip(generateTableDdl(t, snap.engine), 6000)}\n\`\`\``);
        const incoming = snap.tables.filter((x) => x.foreignKeys.some((fk) => fk.refTable === t.name)).map((x) => x.name);
        if (incoming.length) ctx.push(`Referenced by: ${incoming.join(', ')}`);
      }
    } catch (e) {
      ctx.push(`(Could not load selected table metadata: ${(e as Error).message})`);
    }
  }
  if (task.context.sql) ctx.push(`Selected SQL:\n\`\`\`sql\n${clip(task.context.sql, 6000)}\n\`\`\``);
  if (task.context.queryResultSummary) ctx.push(`Last query result: ${clip(task.context.queryResultSummary, 2000)}`);
  if (task.context.notes) ctx.push(`Notes: ${clip(task.context.notes, 2000)}`);

  // Conversation continuity for chat follow-ups.
  if (task.context.parentTaskId) {
    const chain: Task[] = [];
    let cur = taskRepo.get(task.context.parentTaskId);
    while (cur && chain.length < 6) { chain.unshift(cur); cur = cur.context.parentTaskId ? taskRepo.get(cur.context.parentTaskId) : null; }
    if (chain.length) ctx.push(`Previous conversation:\n${chain.map((t) => `User: ${clip(t.title, 500)}\nAssistant: ${clip(t.result ?? t.error ?? '(no answer)', 1500)}`).join('\n\n')}`);
  }

  // Upstream task results and artifacts (structured hand-off between agents).
  for (const depId of task.dependsOn) {
    const dep = taskRepo.get(depId);
    if (!dep) continue;
    ctx.push(`Upstream task "${dep.title}" (${dep.status})${dep.result ? `: ${clip(dep.result, 3000)}` : ''}`);
    for (const a of artifacts.list({ taskId: dep.id, limit: 5 })) {
      ctx.push(`Upstream artifact [${a.type}] "${a.title}" (id=${a.id}):\n${clip(a.content, 4000)}`);
    }
  }

  // Selective knowledge retrieval.
  const kn = searchKnowledge(project.id, `${task.title} ${task.description} ${task.context.table?.name ?? ''}`, 6, agent.id);
  if (kn.length) ctx.push(`Relevant project knowledge:\n${kn.map((k) => `- [${k.category}] ${k.title}: ${clip(k.content, 600)}`).join('\n')}`);

  parts.push(`## Context\n${ctx.join('\n\n')}`);
  return parts.join('\n\n');
}
