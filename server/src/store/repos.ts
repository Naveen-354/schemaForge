import type {
  Agent, AgentInput, AgentPermissions, AgentRun, AgentStatus, Approval, Artifact, ArtifactType,
  ConnectionInput, DatabaseConnection, DiagramLayout, KnowledgeEntry, Project, QueryHistoryEntry, RunMessage,
  SavedQuery, SchemaSnapshot, SfEvent, Task, TaskInput, TaskStatus, UsageTotals, Workspace,
} from '@schemaforge/shared';
import { DEFAULT_PERMISSIONS } from '@schemaforge/shared';
import { getDb, j, newId, now, pj, type Row } from './db.js';
import { encryptSecret, decryptSecret } from '../secrets.js';

// ---------- Workspaces ----------

function mapWorkspace(r: Row): Workspace {
  return { id: String(r.id), name: String(r.name), createdAt: String(r.created_at) };
}

export const workspaces = {
  list(): Workspace[] {
    return getDb().prepare('SELECT * FROM workspaces ORDER BY created_at').all().map(mapWorkspace);
  },
  get(id: string): Workspace | null {
    const r = getDb().prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
    return r ? mapWorkspace(r) : null;
  },
  create(name: string): Workspace {
    const w: Workspace = { id: newId(), name, createdAt: now() };
    getDb().prepare('INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)').run(w.id, w.name, w.createdAt);
    return w;
  },
  rename(id: string, name: string): Workspace | null {
    getDb().prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name, id);
    return this.get(id);
  },
};

// ---------- Projects ----------

function mapProject(r: Row): Project {
  return {
    id: String(r.id), workspaceId: String(r.workspace_id), name: String(r.name), description: String(r.description ?? ''),
    rootPath: (r.root_path as string | null) ?? null, instructions: String(r.instructions ?? ''),
    createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  };
}

export const projects = {
  list(workspaceId?: string): Project[] {
    const db = getDb();
    const rows = workspaceId
      ? db.prepare('SELECT * FROM projects WHERE workspace_id = ? ORDER BY created_at').all(workspaceId)
      : db.prepare('SELECT * FROM projects ORDER BY created_at').all();
    return rows.map(mapProject);
  },
  get(id: string): Project | null {
    const r = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id);
    return r ? mapProject(r) : null;
  },
  create(input: { workspaceId: string; name: string; description?: string; rootPath?: string | null; instructions?: string }): Project {
    const t = now();
    const p: Project = {
      id: newId(), workspaceId: input.workspaceId, name: input.name, description: input.description ?? '',
      rootPath: input.rootPath ?? null, instructions: input.instructions ?? '', createdAt: t, updatedAt: t,
    };
    getDb().prepare(
      'INSERT INTO projects (id, workspace_id, name, description, root_path, instructions, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    ).run(p.id, p.workspaceId, p.name, p.description, p.rootPath, p.instructions, p.createdAt, p.updatedAt);
    return p;
  },
  update(id: string, patch: Partial<Pick<Project, 'name' | 'description' | 'rootPath' | 'instructions'>>): Project | null {
    const cur = this.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch, updatedAt: now() };
    getDb().prepare('UPDATE projects SET name=?, description=?, root_path=?, instructions=?, updated_at=? WHERE id=?')
      .run(next.name, next.description, next.rootPath, next.instructions, next.updatedAt, id);
    return next;
  },
  delete(id: string): void {
    const db = getDb();
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    db.prepare('DELETE FROM connections WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM tasks WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM artifacts WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM knowledge WHERE project_id = ?').run(id);
  },
};

// ---------- Connections ----------

function mapConnection(r: Row): DatabaseConnection {
  return {
    id: String(r.id), projectId: String(r.project_id), name: String(r.name), engine: r.engine as DatabaseConnection['engine'],
    host: (r.host as string | null) ?? null, port: r.port == null ? null : Number(r.port), database: String(r.database),
    username: (r.username as string | null) ?? null, hasPassword: !!r.password_enc, ssl: !!r.ssl,
    filePath: (r.file_path as string | null) ?? null, schemas: pj<string[]>(r.schemas, []),
    status: (r.status as DatabaseConnection['status']) ?? 'unknown', lastError: (r.last_error as string | null) ?? null,
    readOnly: !!r.read_only, createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  };
}

export const connections = {
  list(projectId?: string): DatabaseConnection[] {
    const db = getDb();
    const rows = projectId
      ? db.prepare('SELECT * FROM connections WHERE project_id = ? ORDER BY created_at').all(projectId)
      : db.prepare('SELECT * FROM connections ORDER BY created_at').all();
    return rows.map(mapConnection);
  },
  get(id: string): DatabaseConnection | null {
    const r = getDb().prepare('SELECT * FROM connections WHERE id = ?').get(id);
    return r ? mapConnection(r) : null;
  },
  /** Password is only ever handed to the DB adapter, never serialized to clients or models. */
  getPassword(id: string): string | null {
    const r = getDb().prepare('SELECT password_enc FROM connections WHERE id = ?').get(id);
    return decryptSecret(r?.password_enc as string | null);
  },
  create(input: ConnectionInput): DatabaseConnection {
    const t = now();
    const id = newId();
    getDb().prepare(
      `INSERT INTO connections (id, project_id, name, engine, host, port, database, username, password_enc, ssl, file_path, schemas, status, read_only, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, input.projectId, input.name, input.engine, input.host ?? null, input.port ?? null, input.database,
      input.username ?? null, input.password ? encryptSecret(input.password) : null, input.ssl ? 1 : 0,
      input.filePath ?? null, j(input.schemas ?? []), 'unknown', input.readOnly ? 1 : 0, t, t,
    );
    return this.get(id)!;
  },
  update(id: string, input: Partial<ConnectionInput>): DatabaseConnection | null {
    const cur = this.get(id);
    if (!cur) return null;
    const db = getDb();
    db.prepare(
      `UPDATE connections SET name=?, engine=?, host=?, port=?, database=?, username=?, ssl=?, file_path=?, schemas=?, read_only=?, updated_at=? WHERE id=?`,
    ).run(
      input.name ?? cur.name, input.engine ?? cur.engine, input.host ?? cur.host, input.port ?? cur.port,
      input.database ?? cur.database, input.username ?? cur.username, (input.ssl ?? cur.ssl) ? 1 : 0,
      input.filePath ?? cur.filePath, j(input.schemas ?? cur.schemas), (input.readOnly ?? cur.readOnly) ? 1 : 0, now(), id,
    );
    if (input.password !== undefined) {
      db.prepare('UPDATE connections SET password_enc = ? WHERE id = ?').run(input.password ? encryptSecret(input.password) : null, id);
    }
    return this.get(id);
  },
  setStatus(id: string, status: DatabaseConnection['status'], lastError: string | null): void {
    getDb().prepare('UPDATE connections SET status=?, last_error=?, updated_at=? WHERE id=?').run(status, lastError, now(), id);
  },
  delete(id: string): void {
    const db = getDb();
    db.prepare('DELETE FROM connections WHERE id = ?').run(id);
    db.prepare('DELETE FROM schema_snapshots WHERE connection_id = ?').run(id);
    db.prepare('DELETE FROM diagram_layouts WHERE connection_id = ?').run(id);
  },
};

export const snapshots = {
  get(connectionId: string): SchemaSnapshot | null {
    const r = getDb().prepare('SELECT snapshot FROM schema_snapshots WHERE connection_id = ?').get(connectionId);
    return r ? pj<SchemaSnapshot | null>(r.snapshot, null) : null;
  },
  save(snapshot: SchemaSnapshot): void {
    getDb().prepare(
      'INSERT INTO schema_snapshots (connection_id, captured_at, snapshot) VALUES (?,?,?) ON CONFLICT(connection_id) DO UPDATE SET captured_at=excluded.captured_at, snapshot=excluded.snapshot',
    ).run(snapshot.connectionId, snapshot.capturedAt, j(snapshot));
  },
};

export const layouts = {
  get(connectionId: string): DiagramLayout | null {
    const r = getDb().prepare('SELECT * FROM diagram_layouts WHERE connection_id = ?').get(connectionId);
    if (!r) return null;
    return { connectionId, positions: pj(r.positions, {}), hidden: pj(r.hidden, []), updatedAt: String(r.updated_at) };
  },
  save(layout: DiagramLayout): DiagramLayout {
    const t = now();
    getDb().prepare(
      'INSERT INTO diagram_layouts (connection_id, positions, hidden, updated_at) VALUES (?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET positions=excluded.positions, hidden=excluded.hidden, updated_at=excluded.updated_at',
    ).run(layout.connectionId, j(layout.positions), j(layout.hidden), t);
    return { ...layout, updatedAt: t };
  },
};

// ---------- Agents ----------

function mapAgent(r: Row): Agent {
  return {
    id: String(r.id), workspaceId: String(r.workspace_id), projectId: (r.project_id as string | null) ?? null,
    name: String(r.name), role: String(r.role), instructions: String(r.instructions ?? ''),
    provider: r.provider as Agent['provider'], model: String(r.model), capabilities: pj<string[]>(r.capabilities, []),
    permissions: { ...DEFAULT_PERMISSIONS, ...pj<Partial<AgentPermissions>>(r.permissions, {}) },
    status: r.status as AgentStatus, statusMessage: (r.status_message as string | null) ?? null,
    currentTaskId: (r.current_task_id as string | null) ?? null, currentRunId: (r.current_run_id as string | null) ?? null,
    maxIterations: Number(r.max_iterations ?? 20), createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  };
}

export const agents = {
  list(filter?: { workspaceId?: string; projectId?: string }): Agent[] {
    let rows: Row[];
    if (filter?.projectId) {
      rows = getDb().prepare('SELECT * FROM agents WHERE project_id = ? OR project_id IS NULL ORDER BY created_at').all(filter.projectId);
    } else if (filter?.workspaceId) {
      rows = getDb().prepare('SELECT * FROM agents WHERE workspace_id = ? ORDER BY created_at').all(filter.workspaceId);
    } else {
      rows = getDb().prepare('SELECT * FROM agents ORDER BY created_at').all();
    }
    return rows.map(mapAgent);
  },
  get(id: string): Agent | null {
    const r = getDb().prepare('SELECT * FROM agents WHERE id = ?').get(id);
    return r ? mapAgent(r) : null;
  },
  create(input: AgentInput & { workspaceId: string }): Agent {
    const t = now();
    const id = newId();
    const perms: AgentPermissions = {
      ...DEFAULT_PERMISSIONS,
      ...input.permissions,
      sql: { ...DEFAULT_PERMISSIONS.sql, ...(input.permissions?.sql ?? {}) },
      tools: { ...(input.permissions?.tools ?? {}) },
    };
    getDb().prepare(
      `INSERT INTO agents (id, workspace_id, project_id, name, role, instructions, provider, model, capabilities, permissions, status, max_iterations, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, input.workspaceId, input.projectId ?? null, input.name, input.role, input.instructions ?? '',
      input.provider ?? 'heuristic', input.model ?? 'heuristic-v1', j(input.capabilities ?? []), j(perms), 'IDLE',
      input.maxIterations ?? 20, t, t,
    );
    return this.get(id)!;
  },
  update(id: string, input: Partial<AgentInput>): Agent | null {
    const cur = this.get(id);
    if (!cur) return null;
    const perms: AgentPermissions = input.permissions
      ? { ...cur.permissions, ...input.permissions, sql: { ...cur.permissions.sql, ...(input.permissions.sql ?? {}) }, tools: input.permissions.tools ?? cur.permissions.tools }
      : cur.permissions;
    getDb().prepare(
      `UPDATE agents SET project_id=?, name=?, role=?, instructions=?, provider=?, model=?, capabilities=?, permissions=?, max_iterations=?, updated_at=? WHERE id=?`,
    ).run(
      input.projectId === undefined ? cur.projectId : input.projectId, input.name ?? cur.name, input.role ?? cur.role,
      input.instructions ?? cur.instructions, input.provider ?? cur.provider, input.model ?? cur.model,
      j(input.capabilities ?? cur.capabilities), j(perms), input.maxIterations ?? cur.maxIterations, now(), id,
    );
    return this.get(id);
  },
  setStatus(id: string, status: AgentStatus, statusMessage: string | null, taskId?: string | null, runId?: string | null): Agent | null {
    const cur = this.get(id);
    if (!cur) return null;
    getDb().prepare('UPDATE agents SET status=?, status_message=?, current_task_id=?, current_run_id=?, updated_at=? WHERE id=?')
      .run(status, statusMessage, taskId === undefined ? cur.currentTaskId : taskId, runId === undefined ? cur.currentRunId : runId, now(), id);
    return this.get(id);
  },
  delete(id: string): void {
    getDb().prepare('DELETE FROM agents WHERE id = ?').run(id);
  },
};

// ---------- Tasks ----------

function mapTask(r: Row): Task {
  return {
    id: String(r.id), projectId: String(r.project_id), connectionId: (r.connection_id as string | null) ?? null,
    title: String(r.title), description: String(r.description ?? ''), agentId: (r.agent_id as string | null) ?? null,
    priority: r.priority as Task['priority'], status: r.status as TaskStatus, dependsOn: pj<string[]>(r.depends_on, []),
    context: pj(r.context, {}), result: (r.result as string | null) ?? null, error: (r.error as string | null) ?? null,
    currentRunId: (r.current_run_id as string | null) ?? null, createdAt: String(r.created_at), updatedAt: String(r.updated_at),
    startedAt: (r.started_at as string | null) ?? null, completedAt: (r.completed_at as string | null) ?? null,
  };
}

export const tasks = {
  list(filter?: { projectId?: string; agentId?: string; status?: TaskStatus }): Task[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter?.projectId) { where.push('project_id = ?'); params.push(filter.projectId); }
    if (filter?.agentId) { where.push('agent_id = ?'); params.push(filter.agentId); }
    if (filter?.status) { where.push('status = ?'); params.push(filter.status); }
    const sql = `SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`;
    return getDb().prepare(sql).all(...(params as string[])).map(mapTask);
  },
  get(id: string): Task | null {
    const r = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    return r ? mapTask(r) : null;
  },
  create(input: TaskInput): Task {
    const t = now();
    const id = newId();
    getDb().prepare(
      `INSERT INTO tasks (id, project_id, connection_id, title, description, agent_id, priority, status, depends_on, context, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, input.projectId, input.connectionId ?? null, input.title, input.description ?? '', input.agentId ?? null,
      input.priority ?? 'normal', 'TODO', j(input.dependsOn ?? []), j(input.context ?? {}), t, t,
    );
    return this.get(id)!;
  },
  update(id: string, patch: Partial<Task>): Task | null {
    const cur = this.get(id);
    if (!cur) return null;
    const next: Task = { ...cur, ...patch, updatedAt: now() };
    getDb().prepare(
      `UPDATE tasks SET connection_id=?, title=?, description=?, agent_id=?, priority=?, status=?, depends_on=?, context=?, result=?, error=?, current_run_id=?, updated_at=?, started_at=?, completed_at=? WHERE id=?`,
    ).run(
      next.connectionId, next.title, next.description, next.agentId, next.priority, next.status, j(next.dependsOn), j(next.context),
      next.result, next.error, next.currentRunId, next.updatedAt, next.startedAt, next.completedAt, id,
    );
    return next;
  },
  delete(id: string): void {
    getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id);
  },
};

// ---------- Runs ----------

const zeroUsage = (): UsageTotals => ({ calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, latencyMs: 0 });

function mapRun(r: Row): AgentRun {
  return {
    id: String(r.id), taskId: String(r.task_id), agentId: String(r.agent_id), projectId: String(r.project_id),
    status: r.status as AgentStatus, iterations: Number(r.iterations ?? 0), provider: r.provider as AgentRun['provider'],
    model: String(r.model), usage: pj<UsageTotals>(r.usage, zeroUsage()), error: (r.error as string | null) ?? null,
    startedAt: String(r.started_at), endedAt: (r.ended_at as string | null) ?? null,
  };
}

export const runs = {
  list(filter?: { taskId?: string; agentId?: string; projectId?: string; limit?: number }): AgentRun[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter?.taskId) { where.push('task_id = ?'); params.push(filter.taskId); }
    if (filter?.agentId) { where.push('agent_id = ?'); params.push(filter.agentId); }
    if (filter?.projectId) { where.push('project_id = ?'); params.push(filter.projectId); }
    const sql = `SELECT * FROM runs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY started_at DESC LIMIT ${filter?.limit ?? 200}`;
    return getDb().prepare(sql).all(...(params as string[])).map(mapRun);
  },
  get(id: string): AgentRun | null {
    const r = getDb().prepare('SELECT * FROM runs WHERE id = ?').get(id);
    return r ? mapRun(r) : null;
  },
  create(input: { taskId: string; agentId: string; projectId: string; provider: string; model: string }): AgentRun {
    const id = newId();
    getDb().prepare(
      'INSERT INTO runs (id, task_id, agent_id, project_id, status, iterations, provider, model, usage, started_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ).run(id, input.taskId, input.agentId, input.projectId, 'RUNNING', 0, input.provider, input.model, j(zeroUsage()), now());
    return this.get(id)!;
  },
  update(id: string, patch: Partial<AgentRun>): AgentRun | null {
    const cur = this.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    getDb().prepare('UPDATE runs SET status=?, iterations=?, usage=?, error=?, ended_at=? WHERE id=?')
      .run(next.status, next.iterations, j(next.usage), next.error, next.endedAt, id);
    return next;
  },
  usageTotals(filter?: { projectId?: string; agentId?: string }): UsageTotals {
    const all = this.list({ ...filter, limit: 100_000 });
    return all.reduce((acc, r) => ({
      calls: acc.calls + r.usage.calls, inputTokens: acc.inputTokens + r.usage.inputTokens,
      outputTokens: acc.outputTokens + r.usage.outputTokens, estimatedCostUsd: acc.estimatedCostUsd + r.usage.estimatedCostUsd,
      latencyMs: acc.latencyMs + r.usage.latencyMs,
    }), zeroUsage());
  },
};

function mapRunMessage(r: Row): RunMessage {
  return {
    id: String(r.id), runId: String(r.run_id), seq: Number(r.seq), role: r.role as RunMessage['role'],
    content: String(r.content), toolName: (r.tool_name as string | null) ?? null, createdAt: String(r.created_at),
  };
}

export const runMessages = {
  list(runId: string): RunMessage[] {
    return getDb().prepare('SELECT * FROM run_messages WHERE run_id = ? ORDER BY seq').all(runId).map(mapRunMessage);
  },
  add(runId: string, role: RunMessage['role'], content: string, toolName?: string | null): RunMessage {
    const db = getDb();
    const max = db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM run_messages WHERE run_id = ?').get(runId) as Row;
    const seq = Number(max.m) + 1;
    const id = newId();
    const t = now();
    db.prepare('INSERT INTO run_messages (id, run_id, seq, role, content, tool_name, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, runId, seq, role, content, toolName ?? null, t);
    return { id, runId, seq, role, content, toolName: toolName ?? null, createdAt: t };
  },
};

// ---------- Events ----------

function mapEvent(r: Row): SfEvent {
  return {
    id: String(r.id), seq: Number(r.seq), type: r.type as SfEvent['type'], level: r.level as SfEvent['level'],
    workspaceId: String(r.workspace_id), projectId: (r.project_id as string | null) ?? null,
    agentId: (r.agent_id as string | null) ?? null, taskId: (r.task_id as string | null) ?? null,
    runId: (r.run_id as string | null) ?? null, connectionId: (r.connection_id as string | null) ?? null,
    message: String(r.message), data: pj<Record<string, unknown> | null>(r.data, null), createdAt: String(r.created_at),
  };
}

export interface EventFilter {
  workspaceId?: string; projectId?: string; agentId?: string; taskId?: string; runId?: string; connectionId?: string;
  type?: string; level?: string; afterSeq?: number; since?: string; limit?: number;
}

export const events = {
  insert(e: Omit<SfEvent, 'seq'>): SfEvent {
    const db = getDb();
    const res = db.prepare(
      'INSERT INTO events (id, type, level, workspace_id, project_id, agent_id, task_id, run_id, connection_id, message, data, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run(e.id, e.type, e.level, e.workspaceId, e.projectId, e.agentId, e.taskId, e.runId, e.connectionId, e.message, e.data ? j(e.data) : null, e.createdAt);
    return { ...e, seq: Number(res.lastInsertRowid) };
  },
  list(f: EventFilter = {}): SfEvent[] {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => { if (v !== undefined && v !== null && v !== '') { where.push(`${col} = ?`); params.push(v); } };
    add('workspace_id', f.workspaceId); add('project_id', f.projectId); add('agent_id', f.agentId); add('task_id', f.taskId);
    add('run_id', f.runId); add('connection_id', f.connectionId); add('level', f.level);
    if (f.type) {
      if (f.type.endsWith('.*')) { where.push('type LIKE ?'); params.push(f.type.slice(0, -1) + '%'); }
      else { where.push('type = ?'); params.push(f.type); }
    }
    if (f.afterSeq) { where.push('seq > ?'); params.push(f.afterSeq); }
    if (f.since) { where.push('created_at >= ?'); params.push(f.since); }
    const sql = `SELECT * FROM events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY seq DESC LIMIT ${Math.min(f.limit ?? 200, 2000)}`;
    return getDb().prepare(sql).all(...(params as string[])).map(mapEvent).reverse();
  },
  lastSeq(): number {
    const r = getDb().prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM events').get() as Row;
    return Number(r.m);
  },
};

// ---------- Approvals ----------

function mapApproval(r: Row): Approval {
  return {
    id: String(r.id), projectId: String(r.project_id), taskId: String(r.task_id), agentId: String(r.agent_id), runId: String(r.run_id),
    toolName: String(r.tool_name), summary: String(r.summary), detail: String(r.detail), risk: String(r.risk),
    input: pj(r.input, {}), status: r.status as Approval['status'], resolution: (r.resolution as string | null) ?? null,
    createdAt: String(r.created_at), resolvedAt: (r.resolved_at as string | null) ?? null,
  };
}

export const approvals = {
  list(filter?: { projectId?: string; status?: string; taskId?: string }): Approval[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter?.projectId) { where.push('project_id = ?'); params.push(filter.projectId); }
    if (filter?.status) { where.push('status = ?'); params.push(filter.status); }
    if (filter?.taskId) { where.push('task_id = ?'); params.push(filter.taskId); }
    const sql = `SELECT * FROM approvals ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 500`;
    return getDb().prepare(sql).all(...(params as string[])).map(mapApproval);
  },
  get(id: string): Approval | null {
    const r = getDb().prepare('SELECT * FROM approvals WHERE id = ?').get(id);
    return r ? mapApproval(r) : null;
  },
  create(input: Omit<Approval, 'id' | 'status' | 'resolution' | 'createdAt' | 'resolvedAt'>): Approval {
    const id = newId();
    getDb().prepare(
      'INSERT INTO approvals (id, project_id, task_id, agent_id, run_id, tool_name, summary, detail, risk, input, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run(id, input.projectId, input.taskId, input.agentId, input.runId, input.toolName, input.summary, input.detail, input.risk, j(input.input), 'pending', now());
    return this.get(id)!;
  },
  resolve(id: string, status: Approval['status'], resolution: string | null): Approval | null {
    getDb().prepare('UPDATE approvals SET status=?, resolution=?, resolved_at=? WHERE id=?').run(status, resolution, now(), id);
    return this.get(id);
  },
  expirePending(): number {
    const res = getDb().prepare("UPDATE approvals SET status='expired', resolved_at=? WHERE status='pending'").run(now());
    return Number(res.changes);
  },
};

// ---------- Artifacts ----------

function mapArtifact(r: Row): Artifact {
  return {
    id: String(r.id), projectId: String(r.project_id), taskId: (r.task_id as string | null) ?? null,
    agentId: (r.agent_id as string | null) ?? null, runId: (r.run_id as string | null) ?? null,
    type: r.type as ArtifactType, title: String(r.title), content: String(r.content),
    language: (r.language as string | null) ?? null, metadata: pj(r.metadata, {}), createdAt: String(r.created_at),
  };
}

export const artifacts = {
  list(filter?: { projectId?: string; taskId?: string; agentId?: string; type?: string; limit?: number }): Artifact[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter?.projectId) { where.push('project_id = ?'); params.push(filter.projectId); }
    if (filter?.taskId) { where.push('task_id = ?'); params.push(filter.taskId); }
    if (filter?.agentId) { where.push('agent_id = ?'); params.push(filter.agentId); }
    if (filter?.type) { where.push('type = ?'); params.push(filter.type); }
    const sql = `SELECT * FROM artifacts ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ${filter?.limit ?? 500}`;
    return getDb().prepare(sql).all(...(params as string[])).map(mapArtifact);
  },
  get(id: string): Artifact | null {
    const r = getDb().prepare('SELECT * FROM artifacts WHERE id = ?').get(id);
    return r ? mapArtifact(r) : null;
  },
  create(input: Omit<Artifact, 'id' | 'createdAt'>): Artifact {
    const id = newId();
    getDb().prepare(
      'INSERT INTO artifacts (id, project_id, task_id, agent_id, run_id, type, title, content, language, metadata, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    ).run(id, input.projectId, input.taskId, input.agentId, input.runId, input.type, input.title, input.content, input.language, j(input.metadata ?? {}), now());
    return this.get(id)!;
  },
  delete(id: string): void {
    getDb().prepare('DELETE FROM artifacts WHERE id = ?').run(id);
  },
};

// ---------- Knowledge ----------

function mapKnowledge(r: Row): KnowledgeEntry {
  return {
    id: String(r.id), projectId: (r.project_id as string | null) ?? null, scope: r.scope as KnowledgeEntry['scope'],
    agentId: (r.agent_id as string | null) ?? null, category: String(r.category), title: String(r.title),
    content: String(r.content), tags: pj<string[]>(r.tags, []), createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  };
}

export const knowledge = {
  list(filter?: { projectId?: string; scope?: string; agentId?: string }): KnowledgeEntry[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter?.projectId) { where.push('(project_id = ? OR project_id IS NULL)'); params.push(filter.projectId); }
    if (filter?.scope) { where.push('scope = ?'); params.push(filter.scope); }
    if (filter?.agentId) { where.push('agent_id = ?'); params.push(filter.agentId); }
    const sql = `SELECT * FROM knowledge ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC`;
    return getDb().prepare(sql).all(...(params as string[])).map(mapKnowledge);
  },
  get(id: string): KnowledgeEntry | null {
    const r = getDb().prepare('SELECT * FROM knowledge WHERE id = ?').get(id);
    return r ? mapKnowledge(r) : null;
  },
  create(input: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>): KnowledgeEntry {
    const id = newId();
    const t = now();
    getDb().prepare(
      'INSERT INTO knowledge (id, project_id, scope, agent_id, category, title, content, tags, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ).run(id, input.projectId, input.scope, input.agentId, input.category, input.title, input.content, j(input.tags), t, t);
    return this.get(id)!;
  },
  update(id: string, patch: Partial<KnowledgeEntry>): KnowledgeEntry | null {
    const cur = this.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch, updatedAt: now() };
    getDb().prepare('UPDATE knowledge SET category=?, title=?, content=?, tags=?, updated_at=? WHERE id=?')
      .run(next.category, next.title, next.content, j(next.tags), next.updatedAt, id);
    return next;
  },
  delete(id: string): void {
    getDb().prepare('DELETE FROM knowledge WHERE id = ?').run(id);
  },
};

// ---------- Query history / saved queries ----------

function mapHistory(r: Row): QueryHistoryEntry {
  return {
    id: String(r.id), projectId: String(r.project_id), connectionId: String(r.connection_id), sql: String(r.sql),
    status: r.status as QueryHistoryEntry['status'], durationMs: Number(r.duration_ms), rowCount: r.row_count == null ? null : Number(r.row_count),
    error: (r.error as string | null) ?? null, actorType: r.actor_type as QueryHistoryEntry['actorType'],
    actorId: (r.actor_id as string | null) ?? null, taskId: (r.task_id as string | null) ?? null, tags: pj<string[]>(r.tags, []),
    createdAt: String(r.created_at),
  };
}

export const queryHistory = {
  list(filter?: { projectId?: string; connectionId?: string; limit?: number }): QueryHistoryEntry[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter?.projectId) { where.push('project_id = ?'); params.push(filter.projectId); }
    if (filter?.connectionId) { where.push('connection_id = ?'); params.push(filter.connectionId); }
    const sql = `SELECT * FROM query_history ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ${filter?.limit ?? 200}`;
    return getDb().prepare(sql).all(...(params as string[])).map(mapHistory);
  },
  add(input: Omit<QueryHistoryEntry, 'id' | 'createdAt'>): QueryHistoryEntry {
    const id = newId();
    getDb().prepare(
      'INSERT INTO query_history (id, project_id, connection_id, sql, status, duration_ms, row_count, error, actor_type, actor_id, task_id, tags, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run(id, input.projectId, input.connectionId, input.sql, input.status, input.durationMs, input.rowCount, input.error, input.actorType, input.actorId, input.taskId, j(input.tags), now());
    return { ...input, id, createdAt: now() };
  },
};

function mapSaved(r: Row): SavedQuery {
  return {
    id: String(r.id), projectId: String(r.project_id), connectionId: (r.connection_id as string | null) ?? null,
    name: String(r.name), sql: String(r.sql), description: String(r.description ?? ''),
    createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  };
}

export const savedQueries = {
  list(projectId?: string): SavedQuery[] {
    const rows = projectId
      ? getDb().prepare('SELECT * FROM saved_queries WHERE project_id = ? ORDER BY updated_at DESC').all(projectId)
      : getDb().prepare('SELECT * FROM saved_queries ORDER BY updated_at DESC').all();
    return rows.map(mapSaved);
  },
  get(id: string): SavedQuery | null {
    const r = getDb().prepare('SELECT * FROM saved_queries WHERE id = ?').get(id);
    return r ? mapSaved(r) : null;
  },
  create(input: Omit<SavedQuery, 'id' | 'createdAt' | 'updatedAt'>): SavedQuery {
    const id = newId();
    const t = now();
    getDb().prepare('INSERT INTO saved_queries (id, project_id, connection_id, name, sql, description, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, input.projectId, input.connectionId, input.name, input.sql, input.description, t, t);
    return this.get(id)!;
  },
  update(id: string, patch: Partial<SavedQuery>): SavedQuery | null {
    const cur = this.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch, updatedAt: now() };
    getDb().prepare('UPDATE saved_queries SET name=?, sql=?, description=?, connection_id=?, updated_at=? WHERE id=?')
      .run(next.name, next.sql, next.description, next.connectionId, next.updatedAt, id);
    return next;
  },
  delete(id: string): void {
    getDb().prepare('DELETE FROM saved_queries WHERE id = ?').run(id);
  },
};

// ---------- Settings (API keys encrypted) ----------

export const settings = {
  get(key: string): string | null {
    const r = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return r ? String(r.value) : null;
  },
  set(key: string, value: string | null): void {
    if (value === null) getDb().prepare('DELETE FROM settings WHERE key = ?').run(key);
    else getDb().prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  },
  getSecret(key: string): string | null {
    return decryptSecret(this.get(key));
  },
  setSecret(key: string, value: string | null): void {
    this.set(key, value ? encryptSecret(value) : null);
  },
};
