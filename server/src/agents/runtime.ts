import type { Agent, AgentRun, AgentStatus, Approval, Project, Task, TaskStatus } from '@schemaforge/shared';
import type { ChatMessage, ContentPart } from '../ai/types.js';
import { getProvider } from '../ai/providers/index.js';
import { agents, approvals, artifacts, projects, runMessages, runs, tasks } from '../store/repos.js';
import { bus } from '../events.js';
import { config } from '../config.js';
import { now } from '../store/db.js';
import { buildSystemPrompt, buildTaskPrompt } from './context.js';
import { resolveDecision } from './permissions.js';
import { toolMap, toolSpecs, type ToolContext } from './tools.js';

interface RunControl {
  stop: boolean;
  pause: boolean;
  resume: (() => void) | null;
  abort: AbortController;
}

class StopSignal extends Error {
  constructor(public readonly kind: 'STOPPED' | 'CANCELLED') { super(kind); }
}

const TERMINAL: TaskStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];
const BUSY: AgentStatus[] = ['RUNNING', 'WAITING_FOR_APPROVAL', 'PAUSED', 'WAITING'];

export class AgentRuntime {
  private controls = new Map<string, RunControl>(); // by runId
  private pending = new Map<string, (a: Approval) => void>(); // by approvalId
  private scheduling = false;

  /** Recover persisted state after a restart: nothing keeps running across process boundaries. */
  init(): void {
    const expired = approvals.expirePending();
    for (const run of runs.list({ limit: 1000 }).filter((r) => !r.endedAt)) {
      runs.update(run.id, { status: 'FAILED', error: 'Interrupted by server restart', endedAt: now() });
    }
    for (const t of tasks.list().filter((x) => x.status === 'RUNNING' || x.status === 'WAITING_FOR_APPROVAL' || x.status === 'PAUSED')) {
      tasks.update(t.id, { status: 'FAILED', error: 'Interrupted by server restart. Retry to start a new run.' });
    }
    for (const a of agents.list()) {
      if (BUSY.includes(a.status)) agents.setStatus(a.id, 'IDLE', 'Recovered after restart', null, null);
    }
    if (expired) console.log(`[runtime] expired ${expired} pending approvals`);
    setTimeout(() => this.schedule(), 100);
  }

  // ---------- public controls ----------

  enqueue(taskId: string): Task {
    const t = tasks.get(taskId);
    if (!t) throw new Error('Task not found');
    if (!t.agentId) throw new Error('Assign an agent before starting the task');
    if (t.status === 'RUNNING' || t.status === 'WAITING_FOR_APPROVAL') throw new Error(`Task is already ${t.status}`);
    const updated = tasks.update(taskId, { status: 'QUEUED', error: null })!;
    this.emitTask(updated, 'task.updated', `Task queued for ${agents.get(t.agentId)?.name ?? 'agent'}`);
    this.schedule();
    return updated;
  }

  stop(taskId: string): Task {
    const t = tasks.get(taskId);
    if (!t) throw new Error('Task not found');
    const control = t.currentRunId ? this.controls.get(t.currentRunId) : null;
    if (control) {
      control.stop = true;
      control.abort.abort();
      this.rejectPendingForTask(taskId, 'Task stopped by user');
      if (control.resume) control.resume();
      return t;
    }
    if (t.status === 'QUEUED') {
      const u = tasks.update(taskId, { status: 'CANCELLED' })!;
      this.emitTask(u, 'task.cancelled', 'Task cancelled before start');
      return u;
    }
    return t;
  }

  cancel(taskId: string): Task {
    const t = tasks.get(taskId);
    if (!t) throw new Error('Task not found');
    if (t.status === 'RUNNING' || t.status === 'WAITING_FOR_APPROVAL' || t.status === 'PAUSED') return this.stop(taskId);
    if (TERMINAL.includes(t.status)) return t;
    const u = tasks.update(taskId, { status: 'CANCELLED' })!;
    this.emitTask(u, 'task.cancelled', 'Task cancelled');
    this.schedule();
    return u;
  }

  pause(taskId: string): Task {
    const t = tasks.get(taskId);
    if (!t?.currentRunId) throw new Error('Task is not running');
    const control = this.controls.get(t.currentRunId);
    if (!control) throw new Error('Task is not running');
    control.pause = true;
    return t;
  }

  resume(taskId: string): Task {
    const t = tasks.get(taskId);
    if (!t?.currentRunId) throw new Error('Task is not running');
    const control = this.controls.get(t.currentRunId);
    if (!control) throw new Error('Task is not running');
    control.pause = false;
    control.resume?.();
    return t;
  }

  retry(taskId: string, agentId?: string): Task {
    const t = tasks.get(taskId);
    if (!t) throw new Error('Task not found');
    if (!TERMINAL.includes(t.status) && t.status !== 'BLOCKED' && t.status !== 'TODO') throw new Error(`Task is ${t.status}; stop it first`);
    tasks.update(taskId, { agentId: agentId ?? t.agentId, error: null, currentRunId: null });
    return this.enqueue(taskId);
  }

  resolveApproval(approvalId: string, approve: boolean, note?: string): Approval {
    const a = approvals.get(approvalId);
    if (!a) throw new Error('Approval not found');
    if (a.status !== 'pending') throw new Error(`Approval already ${a.status}`);
    const resolved = approvals.resolve(approvalId, approve ? 'approved' : 'rejected', note ?? null)!;
    const task = tasks.get(a.taskId);
    bus.emitEvent({
      type: 'approval.resolved', level: approve ? 'info' : 'warn', message: `User ${approve ? 'approved' : 'rejected'}: ${a.summary}${note ? ` — ${note}` : ''}`,
      workspaceId: projects.get(a.projectId)?.workspaceId ?? '', projectId: a.projectId, agentId: a.agentId, taskId: a.taskId, runId: a.runId,
      data: { approvalId, approved: approve, toolName: a.toolName, note: note ?? null, detail: a.detail },
    });
    bus.notify('approval', approvalId, a.projectId);
    if (task) bus.notify('task', task.id, task.projectId);
    const waiter = this.pending.get(approvalId);
    if (waiter) { this.pending.delete(approvalId); waiter(resolved); }
    return resolved;
  }

  // ---------- scheduling ----------

  schedule(): void {
    if (this.scheduling) return;
    this.scheduling = true;
    try {
      const queued = tasks.list({ status: 'QUEUED' }).sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority) || a.createdAt.localeCompare(b.createdAt));
      let active = this.controls.size;
      for (const t of queued) {
        if (active >= config.maxConcurrentRuns) break;
        if (!t.agentId) continue;
        const deps = t.dependsOn.map((id) => tasks.get(id)).filter((d): d is Task => !!d);
        if (deps.some((d) => d.status === 'FAILED' || d.status === 'CANCELLED')) {
          const blocked = tasks.update(t.id, { status: 'BLOCKED', error: `Blocked: upstream task "${deps.find((d) => d.status === 'FAILED' || d.status === 'CANCELLED')!.title}" did not complete` })!;
          this.emitTask(blocked, 'task.updated', blocked.error!, 'warn');
          continue;
        }
        if (deps.some((d) => d.status !== 'COMPLETED')) continue;
        const agent = agents.get(t.agentId);
        if (!agent || BUSY.includes(agent.status)) continue;
        active++;
        void this.runTask(t, agent).finally(() => this.schedule());
      }
    } finally {
      this.scheduling = false;
    }
  }

  // ---------- execution ----------

  private async runTask(taskInput: Task, agent: Agent): Promise<void> {
    const project = projects.get(taskInput.projectId);
    if (!project) { tasks.update(taskInput.id, { status: 'FAILED', error: 'Project not found' }); return; }
    const provider = getProvider(agent.provider);
    const run = runs.create({ taskId: taskInput.id, agentId: agent.id, projectId: project.id, provider: agent.provider, model: agent.model });
    const control: RunControl = { stop: false, pause: false, resume: null, abort: new AbortController() };
    this.controls.set(run.id, control);

    let task = tasks.update(taskInput.id, { status: 'RUNNING', currentRunId: run.id, startedAt: now(), error: null })!;
    this.setAgent(agent.id, 'RUNNING', `Starting: ${task.title}`, task.id, run.id);
    this.emitTask(task, 'task.started', `Task started by ${agent.name} (${agent.provider}/${agent.model})`, 'info', run.id);
    bus.notify('run', run.id, project.id);

    const toolCtx: ToolContext = {
      workspaceId: project.workspaceId, project, task, agent, run, connectionId: task.connectionId,
      log: (message, data) => bus.emitEvent({ type: 'log', message, workspaceId: project.workspaceId, projectId: project.id, agentId: agent.id, taskId: task.id, runId: run.id, data: data ?? null }),
    };

    const availableTools = toolSpecs(agent.capabilities.length ? agent.capabilities : undefined)
      .filter((t) => agent.permissions.tools[t.name] !== 'deny');

    let finalText = '';
    let iterations = 0;
    try {
      if (!provider.isConfigured()) throw new Error(`Provider "${provider.name}" is not configured. Add an API key in Settings or switch the agent to the built-in heuristic provider.`);
      const system = buildSystemPrompt(agent, project);
      const prompt = await buildTaskPrompt(task, project, agent);
      runMessages.add(run.id, 'user', prompt);
      const messages: ChatMessage[] = [{ role: 'user', content: [{ type: 'text', text: prompt }] }];

      while (iterations < agent.maxIterations) {
        await this.checkControl(control, task, agent);
        iterations++;
        runs.update(run.id, { iterations });
        this.setAgent(agent.id, 'RUNNING', iterations === 1 ? 'Thinking about the task' : `Working (step ${iterations})`, task.id, run.id);

        const response = await this.callProvider(provider, { model: agent.model, system, messages, tools: availableTools, signal: control.abort.signal });
        const cost = provider.estimateCostUsd(response.model, response.usage);
        const cur = runs.get(run.id)!;
        runs.update(run.id, { usage: { calls: cur.usage.calls + 1, inputTokens: cur.usage.inputTokens + response.usage.inputTokens, outputTokens: cur.usage.outputTokens + response.usage.outputTokens, estimatedCostUsd: cur.usage.estimatedCostUsd + cost, latencyMs: cur.usage.latencyMs + response.latencyMs } });
        bus.emitEvent({
          type: 'ai.usage', message: `${response.model}: ${response.usage.inputTokens} in / ${response.usage.outputTokens} out · ${response.latencyMs}ms${cost ? ` · $${cost.toFixed(4)}` : ''}`,
          workspaceId: project.workspaceId, projectId: project.id, agentId: agent.id, taskId: task.id, runId: run.id,
          data: { provider: provider.id, model: response.model, ...response.usage, costUsd: cost, latencyMs: response.latencyMs },
        });

        if (response.text.trim()) {
          runMessages.add(run.id, 'assistant', response.text);
          bus.emitEvent({ type: 'agent.message', message: response.text.length > 400 ? response.text.slice(0, 400) + '…' : response.text, workspaceId: project.workspaceId, projectId: project.id, agentId: agent.id, taskId: task.id, runId: run.id, data: { full: response.text } });
        }
        if (response.stopReason === 'refusal') throw new Error(response.note ?? 'The model declined to continue.');

        if (response.toolCalls.length === 0) {
          finalText = response.text.trim() || finalText;
          if (response.stopReason === 'max_tokens') finalText += '\n\n(Output was cut off at the token limit.)';
          break;
        }

        const assistantParts: ContentPart[] = [];
        if (response.text) assistantParts.push({ type: 'text', text: response.text });
        for (const c of response.toolCalls) assistantParts.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
        messages.push({ role: 'assistant', content: assistantParts });

        const resultParts: ContentPart[] = [];
        for (const call of response.toolCalls) {
          await this.checkControl(control, task, agent);
          const result = await this.executeToolCall(call, toolCtx, control);
          resultParts.push({ type: 'tool_result', toolUseId: call.id, name: call.name, content: result.content, isError: result.isError });
        }
        messages.push({ role: 'user', content: resultParts });
        task = tasks.get(task.id) ?? task;
        toolCtx.task = task;
      }
      if (iterations >= agent.maxIterations && !finalText) throw new Error(`Iteration limit (${agent.maxIterations}) reached without a final answer`);

      const completed = tasks.update(task.id, { status: 'COMPLETED', result: finalText || '(completed without summary)', completedAt: now(), currentRunId: null })!;
      runs.update(run.id, { status: 'COMPLETED', endedAt: now(), iterations });
      this.setAgent(agent.id, 'COMPLETED', `Completed: ${task.title}`, null, null);
      this.emitTask(completed, 'task.completed', `Task completed: ${completed.title}`, 'info', run.id, { result: finalText.slice(0, 2000) });
    } catch (e) {
      const isStop = e instanceof StopSignal;
      const kind: TaskStatus = isStop ? (e.kind === 'CANCELLED' ? 'CANCELLED' : 'FAILED') : 'FAILED';
      const message = isStop ? (e.kind === 'STOPPED' ? 'Stopped by user' : 'Cancelled by user') : (e instanceof Error ? e.message : String(e));
      const updated = tasks.update(task.id, { status: isStop && e.kind === 'STOPPED' ? 'CANCELLED' : kind, error: message, currentRunId: null })!;
      runs.update(run.id, { status: isStop ? (e.kind as AgentStatus) : 'FAILED', error: message, endedAt: now(), iterations });
      this.setAgent(agent.id, isStop ? 'STOPPED' : 'FAILED', message.slice(0, 200), null, null);
      this.emitTask(updated, isStop ? 'task.cancelled' : 'task.failed', `${isStop ? 'Task stopped' : 'Task failed'}: ${message}`, isStop ? 'warn' : 'error', run.id, { error: message, retryable: !isStop });
    } finally {
      this.controls.delete(run.id);
      bus.notify('run', run.id, project.id);
      bus.notify('agent', agent.id, project.id);
    }
  }

  private async callProvider(provider: ReturnType<typeof getProvider>, req: Parameters<ReturnType<typeof getProvider>['complete']>[0]) {
    try {
      return await provider.complete(req);
    } catch (e) {
      if (req.signal?.aborted) throw new StopSignal('STOPPED');
      const msg = e instanceof Error ? e.message : String(e);
      const status = (e as { status?: number }).status;
      const transient = status === 429 || (status !== undefined && status >= 500) || /ECONNRESET|ETIMEDOUT|fetch failed|overloaded/i.test(msg);
      if (!transient) throw e;
      await new Promise((r) => setTimeout(r, 2500));
      return provider.complete(req);
    }
  }

  private async executeToolCall(call: { id: string; name: string; input: Record<string, unknown> }, ctx: ToolContext, control: RunControl) {
    const { project, agent, task, run } = ctx;
    const base = { workspaceId: project.workspaceId, projectId: project.id, agentId: agent.id, taskId: task.id, runId: run.id, connectionId: ctx.connectionId };
    const tool = toolMap.get(call.name);
    if (!tool) {
      bus.emitEvent({ ...base, type: 'tool.call', level: 'warn', message: `Unknown tool ${call.name}`, data: { tool: call.name, input: call.input, denied: true } });
      return { content: `Unknown tool: ${call.name}`, isError: true };
    }
    let assessment;
    try { assessment = tool.assess(call.input, ctx); } catch (e) { return { content: `Invalid input: ${(e as Error).message}`, isError: true }; }
    const { decision, reason } = resolveDecision({ tool, sqlRisk: assessment.sqlRisk, agent, project, task });
    this.setAgent(agent.id, 'RUNNING', assessment.summary.slice(0, 120), task.id, run.id);
    bus.emitEvent({ ...base, type: 'tool.call', message: `${tool.name}: ${assessment.summary}`, data: { tool: tool.name, input: call.input, decision, reason, risk: assessment.risk, detail: assessment.detail.slice(0, 4000) } });
    runMessages.add(run.id, 'tool', JSON.stringify({ call: tool.name, input: call.input }), tool.name);

    if (decision === 'deny') {
      const msg = `Denied by policy (${reason}): ${assessment.summary}`;
      bus.emitEvent({ ...base, type: 'tool.result', level: 'warn', message: msg, data: { tool: tool.name, denied: true } });
      return { content: `Permission denied: this agent is not allowed to perform "${assessment.summary}" (${assessment.risk}). Explain the intended action to the user instead.`, isError: true };
    }
    if (decision === 'ask') {
      const approval = await this.requestApproval(ctx, control, tool.name, assessment);
      if (approval.status !== 'approved') {
        const msg = approval.status === 'rejected' ? `User rejected: ${assessment.summary}${approval.resolution ? ` — ${approval.resolution}` : ''}` : `Approval ${approval.status}: ${assessment.summary}`;
        bus.emitEvent({ ...base, type: 'tool.result', level: 'warn', message: msg, data: { tool: tool.name, rejected: true } });
        return { content: `The user did not approve this action${approval.resolution ? `: "${approval.resolution}"` : ''}. Do not retry it; adjust your approach or summarize what remains.`, isError: true };
      }
      this.setAgent(agent.id, 'RUNNING', assessment.summary.slice(0, 120), task.id, run.id);
    }
    try {
      const result = await tool.execute(call.input, ctx);
      bus.emitEvent({ ...base, type: 'tool.result', level: result.isError ? 'warn' : 'info', message: `${tool.name} → ${result.summary}`, data: { tool: tool.name, isError: !!result.isError, output: result.content.slice(0, 6000), artifactId: result.artifactId ?? null } });
      runMessages.add(run.id, 'tool', result.content, tool.name);
      if (result.artifactId) {
        const a = artifacts.get(result.artifactId);
        if (a) { bus.emitEvent({ ...base, type: 'artifact.created', message: `Artifact created: ${a.title} [${a.type}]`, data: { artifactId: a.id, type: a.type, title: a.title } }); bus.notify('artifact', a.id, project.id); }
      }
      return { content: result.content, isError: result.isError };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      bus.emitEvent({ ...base, type: 'tool.result', level: 'error', message: `${tool.name} failed: ${msg}`, data: { tool: tool.name, isError: true, output: msg } });
      runMessages.add(run.id, 'tool', `ERROR: ${msg}`, tool.name);
      return { content: `Tool error: ${msg}`, isError: true };
    }
  }

  private requestApproval(ctx: ToolContext, control: RunControl, toolName: string, a: { summary: string; detail: string; risk: string }): Promise<Approval> {
    const { project, agent, task, run } = ctx;
    const approval = approvals.create({ projectId: project.id, taskId: task.id, agentId: agent.id, runId: run.id, toolName, summary: a.summary, detail: a.detail, risk: a.risk, input: {} });
    tasks.update(task.id, { status: 'WAITING_FOR_APPROVAL' });
    this.setAgent(agent.id, 'WAITING_FOR_APPROVAL', `Needs approval: ${a.summary.slice(0, 100)}`, task.id, run.id);
    bus.emitEvent({ type: 'approval.requested', level: 'warn', message: `Approval needed: ${a.summary} (${a.risk})`, workspaceId: project.workspaceId, projectId: project.id, agentId: agent.id, taskId: task.id, runId: run.id, data: { approvalId: approval.id, tool: toolName, detail: a.detail, risk: a.risk } });
    bus.notify('approval', approval.id, project.id);
    bus.notify('task', task.id, project.id);
    return new Promise<Approval>((resolve) => {
      this.pending.set(approval.id, (resolved) => {
        tasks.update(task.id, { status: 'RUNNING' });
        bus.notify('task', task.id, project.id);
        if (control.stop) resolve({ ...resolved, status: 'expired' });
        else resolve(resolved);
      });
    });
  }

  private rejectPendingForTask(taskId: string, note: string): void {
    for (const a of approvals.list({ taskId, status: 'pending' })) {
      approvals.resolve(a.id, 'expired', note);
      const waiter = this.pending.get(a.id);
      this.pending.delete(a.id);
      waiter?.({ ...a, status: 'expired', resolution: note });
    }
  }

  private async checkControl(control: RunControl, task: Task, agent: Agent): Promise<void> {
    if (control.stop) throw new StopSignal('STOPPED');
    if (control.pause) {
      tasks.update(task.id, { status: 'PAUSED' });
      this.setAgent(agent.id, 'PAUSED', 'Paused by user', task.id, undefined);
      this.emitTask(tasks.get(task.id)!, 'task.updated', 'Task paused', 'warn');
      await new Promise<void>((resolve) => { control.resume = resolve; });
      control.resume = null;
      if (control.stop) throw new StopSignal('STOPPED');
      tasks.update(task.id, { status: 'RUNNING' });
      this.setAgent(agent.id, 'RUNNING', 'Resumed', task.id, undefined);
      this.emitTask(tasks.get(task.id)!, 'task.updated', 'Task resumed');
    }
  }

  private setAgent(agentId: string, status: AgentStatus, message: string | null, taskId?: string | null, runId?: string | null): void {
    const a = agents.setStatus(agentId, status, message, taskId, runId);
    if (!a) return;
    bus.notify('agent', agentId, a.projectId);
    const project = a.projectId ? projects.get(a.projectId) : null;
    bus.emitEvent({ type: 'agent.status', message: `${a.name}: ${status}${message ? ` — ${message}` : ''}`, workspaceId: a.workspaceId, projectId: project?.id ?? (taskId ? tasks.get(taskId)?.projectId ?? null : null), agentId, taskId: taskId ?? a.currentTaskId, runId: runId ?? a.currentRunId, data: { status, statusMessage: message } });
  }

  private emitTask(task: Task, type: 'task.created' | 'task.updated' | 'task.started' | 'task.completed' | 'task.failed' | 'task.cancelled', message: string, level: 'info' | 'warn' | 'error' = 'info', runId?: string | null, data?: Record<string, unknown>): void {
    const project = projects.get(task.projectId);
    bus.emitEvent({ type, level, message, workspaceId: project?.workspaceId ?? '', projectId: task.projectId, agentId: task.agentId, taskId: task.id, runId: runId ?? task.currentRunId, connectionId: task.connectionId, data: { status: task.status, title: task.title, ...(data ?? {}) } });
    bus.notify('task', task.id, task.projectId);
  }
}

function priorityRank(p: Task['priority']): number {
  return { low: 0, normal: 1, high: 2, urgent: 3 }[p] ?? 1;
}

export const runtime = new AgentRuntime();

export function createAndStartTask(input: Parameters<typeof tasks.create>[0]): Task {
  const t = tasks.create(input);
  const project = projects.get(t.projectId);
  bus.emitEvent({ type: 'task.created', message: `Task created: ${t.title}`, workspaceId: project?.workspaceId ?? '', projectId: t.projectId, agentId: t.agentId, taskId: t.id, connectionId: t.connectionId, data: { title: t.title } });
  bus.notify('task', t.id, t.projectId);
  if (input.start && t.agentId) return runtime.enqueue(t.id);
  return t;
}

export type { Project };
export type RunInfo = AgentRun;
