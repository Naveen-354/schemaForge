// Shared domain types for SchemaForge (server + web).

export type ID = string;

// ---------- Workspace / Project ----------

export interface Workspace {
  id: ID;
  name: string;
  createdAt: string;
}

export interface Project {
  id: ID;
  workspaceId: ID;
  name: string;
  description: string;
  rootPath: string | null;
  instructions: string;
  createdAt: string;
  updatedAt: string;
}

// ---------- Database connections ----------

export type DbEngine = 'postgres' | 'sqlite';
export type ConnectionStatus = 'unknown' | 'connected' | 'error';

export interface DatabaseConnection {
  id: ID;
  projectId: ID;
  name: string;
  engine: DbEngine;
  host: string | null;
  port: number | null;
  database: string;
  username: string | null;
  hasPassword: boolean;
  ssl: boolean;
  filePath: string | null;
  schemas: string[];
  status: ConnectionStatus;
  lastError: string | null;
  readOnly: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionInput {
  projectId: ID;
  name: string;
  engine: DbEngine;
  host?: string;
  port?: number;
  database: string;
  username?: string;
  password?: string;
  ssl?: boolean;
  filePath?: string;
  schemas?: string[];
  readOnly?: boolean;
}

// ---------- Schema model ----------

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  ordinal: number;
  comment: string | null;
}

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  refSchema: string;
  refTable: string;
  refColumns: string[];
  onDelete: string | null;
  onUpdate: string | null;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
  definition: string | null;
}

export interface ConstraintInfo {
  name: string;
  type: string;
  definition: string;
}

export type TableKind = 'table' | 'view' | 'materialized_view';

export interface TableInfo {
  schema: string;
  name: string;
  kind: TableKind;
  columns: ColumnInfo[];
  primaryKey: string[];
  foreignKeys: ForeignKeyInfo[];
  indexes: IndexInfo[];
  constraints: ConstraintInfo[];
  rowEstimate: number | null;
  comment: string | null;
  definition: string | null;
}

export interface RoutineInfo {
  schema: string;
  name: string;
  kind: 'function' | 'procedure';
  returnType: string | null;
  arguments: string | null;
  language: string | null;
  definition: string | null;
}

export interface TriggerInfo {
  schema: string;
  table: string;
  name: string;
  timing: string;
  event: string;
  definition: string | null;
}

export interface SchemaSnapshot {
  connectionId: ID;
  engine: DbEngine;
  capturedAt: string;
  schemas: string[];
  tables: TableInfo[];
  routines: RoutineInfo[];
  triggers: TriggerInfo[];
}

// ---------- SQL ----------

export type SqlRisk = 'safe' | 'write' | 'ddl' | 'destructive';

export interface SqlClassification {
  risk: SqlRisk;
  statementType: string;
  statements: number;
  reasons: string[];
}

export interface QueryColumn {
  name: string;
  type: string | null;
}

export interface QueryResult {
  columns: QueryColumn[];
  rows: unknown[][];
  rowCount: number;
  affectedRows: number | null;
  truncated: boolean;
  durationMs: number;
  command: string | null;
}

export interface QueryHistoryEntry {
  id: ID;
  projectId: ID;
  connectionId: ID;
  sql: string;
  status: 'ok' | 'error';
  durationMs: number;
  rowCount: number | null;
  error: string | null;
  actorType: 'user' | 'agent';
  actorId: ID | null;
  taskId: ID | null;
  tags: string[];
  createdAt: string;
}

export interface SavedQuery {
  id: ID;
  projectId: ID;
  connectionId: ID | null;
  name: string;
  sql: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

// ---------- Agents ----------

export type AgentStatus =
  | 'IDLE'
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING'
  | 'WAITING_FOR_APPROVAL'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'STOPPED'
  | 'CANCELLED';

export type PermissionDecision = 'allow' | 'ask' | 'deny';

export interface SqlPolicy {
  safe: PermissionDecision;
  write: PermissionDecision;
  ddl: PermissionDecision;
  destructive: PermissionDecision;
}

export interface AgentPermissions {
  /** Per-tool decision; tools not listed fall back to `defaultTool`. */
  tools: Record<string, PermissionDecision>;
  defaultTool: PermissionDecision;
  sql: SqlPolicy;
}

export type ProviderId = 'anthropic' | 'openai' | 'heuristic';

export interface Agent {
  id: ID;
  workspaceId: ID;
  projectId: ID | null;
  name: string;
  role: string;
  instructions: string;
  provider: ProviderId;
  model: string;
  capabilities: string[];
  permissions: AgentPermissions;
  status: AgentStatus;
  statusMessage: string | null;
  currentTaskId: ID | null;
  currentRunId: ID | null;
  maxIterations: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentInput {
  workspaceId?: ID;
  projectId?: ID | null;
  name: string;
  role: string;
  instructions?: string;
  provider?: ProviderId;
  model?: string;
  capabilities?: string[];
  permissions?: Partial<AgentPermissions>;
  maxIterations?: number;
}

// ---------- Tasks ----------

export type TaskStatus =
  | 'TODO'
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING_FOR_APPROVAL'
  | 'PAUSED'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface TaskContext {
  connectionId?: ID;
  table?: { schema: string; name: string };
  sql?: string;
  queryResultSummary?: string;
  parentTaskId?: ID;
  notes?: string;
  kind?: 'task' | 'chat';
}

export interface Task {
  id: ID;
  projectId: ID;
  connectionId: ID | null;
  title: string;
  description: string;
  agentId: ID | null;
  priority: TaskPriority;
  status: TaskStatus;
  dependsOn: ID[];
  context: TaskContext;
  result: string | null;
  error: string | null;
  currentRunId: ID | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface TaskInput {
  projectId: ID;
  connectionId?: ID | null;
  title: string;
  description?: string;
  agentId?: ID | null;
  priority?: TaskPriority;
  dependsOn?: ID[];
  context?: TaskContext;
  /** Queue the task immediately after creation. */
  start?: boolean;
}

// ---------- Runs, events, approvals ----------

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
}

export interface AgentRun {
  id: ID;
  taskId: ID;
  agentId: ID;
  projectId: ID;
  status: AgentStatus;
  iterations: number;
  provider: ProviderId;
  model: string;
  usage: UsageTotals;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}

export type EventType =
  | 'task.created'
  | 'task.updated'
  | 'task.started'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled'
  | 'agent.status'
  | 'agent.message'
  | 'agent.created'
  | 'agent.updated'
  | 'tool.call'
  | 'tool.result'
  | 'approval.requested'
  | 'approval.resolved'
  | 'artifact.created'
  | 'sql.executed'
  | 'knowledge.saved'
  | 'connection.updated'
  | 'project.updated'
  | 'ai.usage'
  | 'error'
  | 'log';

export type EventLevel = 'info' | 'warn' | 'error';

export interface SfEvent {
  id: ID;
  seq: number;
  type: EventType;
  level: EventLevel;
  workspaceId: ID;
  projectId: ID | null;
  agentId: ID | null;
  taskId: ID | null;
  runId: ID | null;
  connectionId: ID | null;
  message: string;
  data: Record<string, unknown> | null;
  createdAt: string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface Approval {
  id: ID;
  projectId: ID;
  taskId: ID;
  agentId: ID;
  runId: ID;
  toolName: string;
  summary: string;
  detail: string;
  risk: string;
  input: Record<string, unknown>;
  status: ApprovalStatus;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

// ---------- Artifacts ----------

export type ArtifactType =
  | 'sql'
  | 'migration'
  | 'analysis'
  | 'document'
  | 'diagram'
  | 'code'
  | 'test-result'
  | 'research'
  | 'report'
  | 'result'
  | 'other';

export interface Artifact {
  id: ID;
  projectId: ID;
  taskId: ID | null;
  agentId: ID | null;
  runId: ID | null;
  type: ArtifactType;
  title: string;
  content: string;
  language: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ---------- Knowledge / memory ----------

export type KnowledgeScope = 'project' | 'agent' | 'user';

export interface KnowledgeEntry {
  id: ID;
  projectId: ID | null;
  scope: KnowledgeScope;
  agentId: ID | null;
  category: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

// ---------- Run transcript ----------

export interface RunMessage {
  id: ID;
  runId: ID;
  seq: number;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName: string | null;
  createdAt: string;
}

// ---------- Settings / providers ----------

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  configured: boolean;
  baseUrl: string | null;
  defaultModel: string;
  models: string[];
}

export interface AppSettings {
  providers: ProviderStatus[];
  dataDir: string;
  version: string;
}

// ---------- Diagram layout ----------

export interface DiagramLayout {
  connectionId: ID;
  positions: Record<string, { x: number; y: number }>;
  hidden: string[];
  updatedAt: string;
}

// ---------- Search ----------

export interface SearchHit {
  kind: 'project' | 'connection' | 'table' | 'column' | 'agent' | 'task' | 'artifact' | 'query' | 'knowledge' | 'event';
  id: string;
  title: string;
  subtitle: string;
  projectId: ID | null;
  ref: Record<string, unknown>;
}

// ---------- Dashboard ----------

export interface WorkspaceOverview {
  workspace: Workspace;
  projects: Project[];
  agents: Agent[];
  tasks: Task[];
  pendingApprovals: Approval[];
  recentArtifacts: Artifact[];
  recentEvents: SfEvent[];
  usage: UsageTotals;
}

export const AGENT_STATUSES: AgentStatus[] = [
  'IDLE', 'QUEUED', 'RUNNING', 'WAITING', 'WAITING_FOR_APPROVAL', 'PAUSED',
  'COMPLETED', 'FAILED', 'STOPPED', 'CANCELLED',
];

export const DEFAULT_PERMISSIONS: AgentPermissions = {
  tools: {},
  defaultTool: 'allow',
  sql: { safe: 'allow', write: 'ask', ddl: 'ask', destructive: 'deny' },
};

// ---------- Auth ----------

export type AuthProvider = 'local' | 'google' | 'github';

export interface AuthUser {
  id: ID;
  email: string;
  provider: AuthProvider;
  createdAt: string;
}

export interface AuthIdentity {
  provider: 'google' | 'github';
  email: string | null;
  createdAt: string;
}

export interface AuthStatus {
  user: AuthUser | null;
  /** False on a fresh install: the first registration creates the owner account. */
  hasUsers: boolean;
  registrationOpen: boolean;
  /** Which external sign-in providers the server has credentials for. */
  providers: { google: boolean; github: boolean };
  /** For the signed-in user: whether a password is set and which external accounts are connected. */
  hasPassword: boolean;
  identities: AuthIdentity[];
}

export function tableKey(schema: string, name: string): string {
  return `${schema}.${name}`;
}
