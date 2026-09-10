import type {
  Agent, AgentInput, AgentRun, AppSettings, Approval, Artifact, ConnectionInput, DatabaseConnection, DiagramLayout,
  KnowledgeEntry, Project, QueryHistoryEntry, QueryResult, RunMessage, SavedQuery, SchemaSnapshot, SearchHit, SfEvent,
  SqlClassification, TableInfo, Task, TaskContext, TaskInput, Workspace, WorkspaceOverview,
} from '@schemaforge/shared';

export class ApiError extends Error {
  constructor(message: string, public status: number, public body: unknown) {
    super(message);
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data as { error?: string; message?: string })?.message ?? (data as { error?: string })?.error ?? `${res.status} ${res.statusText}`;
    throw new ApiError(msg, res.status, data);
  }
  return data as T;
}

const qs = (params: Record<string, string | number | boolean | null | undefined>) => {
  const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return p.length ? `?${p.join('&')}` : '';
};

export interface LintFinding { code: string; severity: 'high' | 'medium' | 'low' | 'info'; table: string; column: string | null; message: string; suggestion: string | null }
export interface TableDetail { table: TableInfo; ddl: string; referencedBy: { table: string; foreignKeys: TableInfo['foreignKeys'] }[]; findings: LintFinding[] }
export interface ExecuteOutcome { result: QueryResult | null; error: string | null; classification: SqlClassification; historyId: string }
export type SettingsResponse = AppSettings & { values: Record<string, string | null>; secrets: Record<string, boolean> };

export const api = {
  health: () => req<{ ok: boolean; version: string }>('GET', '/health'),
  workspaces: () => req<Workspace[]>('GET', '/workspaces'),
  overview: (workspaceId: string) => req<WorkspaceOverview>('GET', `/overview${qs({ workspaceId })}`),

  projects: (workspaceId?: string) => req<Project[]>('GET', `/projects${qs({ workspaceId })}`),
  createProject: (body: { workspaceId: string; name: string; description?: string; rootPath?: string | null; instructions?: string }) => req<Project>('POST', '/projects', body),
  updateProject: (id: string, body: Partial<Project>) => req<Project>('PATCH', `/projects/${id}`, body),
  deleteProject: (id: string) => req<{ ok: true }>('DELETE', `/projects/${id}`),

  connections: (projectId?: string) => req<DatabaseConnection[]>('GET', `/connections${qs({ projectId })}`),
  createConnection: (body: ConnectionInput) => req<DatabaseConnection>('POST', '/connections', body),
  updateConnection: (id: string, body: Partial<ConnectionInput>) => req<DatabaseConnection>('PATCH', `/connections/${id}`, body),
  deleteConnection: (id: string) => req<{ ok: true }>('DELETE', `/connections/${id}`),
  testConnection: (id: string) => req<{ ok: boolean; serverVersion?: string; error?: string }>('POST', `/connections/${id}/test`),
  schema: (id: string, refresh = false) => req<SchemaSnapshot>('GET', `/connections/${id}/schema${qs({ refresh: refresh ? 1 : undefined })}`),
  table: (id: string, table: string) => req<TableDetail>('GET', `/connections/${id}/tables/${encodeURIComponent(table)}`),
  lint: (id: string) => req<{ findings: LintFinding[]; tables: number }>('GET', `/connections/${id}/lint`),
  layout: (id: string) => req<DiagramLayout>('GET', `/connections/${id}/layout`),
  saveLayout: (id: string, body: { positions: Record<string, { x: number; y: number }>; hidden: string[] }) => req<DiagramLayout>('PUT', `/connections/${id}/layout`, body),

  classify: (sql: string) => req<SqlClassification & { tables: string[] }>('POST', '/sql/classify', { sql }),
  execute: (body: { connectionId: string; sql: string; dryRun?: boolean; maxRows?: number; confirmRisk?: boolean }) => req<ExecuteOutcome>('POST', '/sql/execute', body),
  explain: (body: { connectionId: string; sql: string; analyze?: boolean }) => req<{ plan: string }>('POST', '/sql/explain', body),
  history: (projectId?: string, connectionId?: string) => req<QueryHistoryEntry[]>('GET', `/sql/history${qs({ projectId, connectionId, limit: 200 })}`),
  savedQueries: (projectId?: string) => req<SavedQuery[]>('GET', `/sql/saved${qs({ projectId })}`),
  saveQuery: (body: Omit<SavedQuery, 'id' | 'createdAt' | 'updatedAt'>) => req<SavedQuery>('POST', '/sql/saved', body),
  updateSavedQuery: (id: string, body: Partial<SavedQuery>) => req<SavedQuery>('PATCH', `/sql/saved/${id}`, body),
  deleteSavedQuery: (id: string) => req<{ ok: true }>('DELETE', `/sql/saved/${id}`),

  agents: (params?: { workspaceId?: string; projectId?: string }) => req<Agent[]>('GET', `/agents${qs(params ?? {})}`),
  agentTools: () => req<{ name: string; description: string; risk: string }[]>('GET', '/agents/tools'),
  createAgent: (body: AgentInput) => req<Agent>('POST', '/agents', body),
  updateAgent: (id: string, body: Partial<AgentInput>) => req<Agent>('PATCH', `/agents/${id}`, body),
  deleteAgent: (id: string) => req<{ ok: true }>('DELETE', `/agents/${id}`),
  resetAgent: (id: string) => req<Agent>('POST', `/agents/${id}/reset`),
  agentRuns: (id: string) => req<AgentRun[]>('GET', `/agents/${id}/runs`),

  tasks: (params?: { projectId?: string; agentId?: string; status?: string }) => req<Task[]>('GET', `/tasks${qs(params ?? {})}`),
  task: (id: string) => req<Task>('GET', `/tasks/${id}`),
  createTask: (body: TaskInput) => req<Task>('POST', '/tasks', body),
  updateTask: (id: string, body: Partial<Task>) => req<Task>('PATCH', `/tasks/${id}`, body),
  deleteTask: (id: string) => req<{ ok: true }>('DELETE', `/tasks/${id}`),
  taskAction: (id: string, action: 'start' | 'stop' | 'cancel' | 'pause' | 'resume' | 'retry', body?: unknown) => req<Task>('POST', `/tasks/${id}/${action}`, body ?? {}),
  taskRuns: (id: string) => req<AgentRun[]>('GET', `/tasks/${id}/runs`),
  ask: (body: { projectId: string; question: string; agentId?: string; connectionId?: string | null; context?: TaskContext }) => req<Task>('POST', '/ask', body),
  run: (id: string) => req<AgentRun & { messages: RunMessage[] }>('GET', `/runs/${id}`),

  approvals: (params?: { projectId?: string; status?: string; taskId?: string }) => req<Approval[]>('GET', `/approvals${qs(params ?? {})}`),
  approve: (id: string, note?: string) => req<Approval>('POST', `/approvals/${id}/approve`, { note }),
  reject: (id: string, note?: string) => req<Approval>('POST', `/approvals/${id}/reject`, { note }),

  artifacts: (params?: { projectId?: string; taskId?: string; agentId?: string; type?: string }) => req<Artifact[]>('GET', `/artifacts${qs(params ?? {})}`),
  artifact: (id: string) => req<Artifact>('GET', `/artifacts/${id}`),
  createArtifact: (body: Partial<Artifact> & { projectId: string; type: string; title: string; content: string }) => req<Artifact>('POST', '/artifacts', body),
  deleteArtifact: (id: string) => req<{ ok: true }>('DELETE', `/artifacts/${id}`),

  knowledge: (params?: { projectId?: string; q?: string; scope?: string }) => req<KnowledgeEntry[]>('GET', `/knowledge${qs(params ?? {})}`),
  createKnowledge: (body: Partial<KnowledgeEntry> & { projectId: string; category: string; title: string; content: string }) => req<KnowledgeEntry>('POST', '/knowledge', body),
  updateKnowledge: (id: string, body: Partial<KnowledgeEntry>) => req<KnowledgeEntry>('PATCH', `/knowledge/${id}`, body),
  deleteKnowledge: (id: string) => req<{ ok: true }>('DELETE', `/knowledge/${id}`),

  events: (params: Record<string, string | number | undefined>) => req<SfEvent[]>('GET', `/events${qs(params)}`),
  search: (q: string, projectId?: string) => req<SearchHit[]>('GET', `/search${qs({ q, projectId })}`),
  settings: () => req<SettingsResponse>('GET', '/settings'),
  saveSettings: (body: Record<string, string | null>) => req<{ ok: true }>('PUT', '/settings', body),
};
