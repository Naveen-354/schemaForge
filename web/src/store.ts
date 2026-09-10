import { create } from 'zustand';
import type {
  Agent, Approval, Artifact, DatabaseConnection, KnowledgeEntry, Project, SavedQuery, SchemaSnapshot, SfEvent, Task, Workspace,
} from '@schemaforge/shared';
import { api, type ExecuteOutcome } from './api';

export type TabKind = 'dashboard' | 'table' | 'diagram' | 'sql' | 'agent' | 'task' | 'artifact' | 'knowledge' | 'settings' | 'project' | 'agents' | 'tasks' | 'artifacts' | 'connection' | 'tools';

export interface Tab {
  id: string;
  kind: TabKind;
  title: string;
  params: Record<string, string>;
}

export interface Selection {
  connectionId?: string;
  table?: { schema: string; name: string };
  sql?: string;
  resultSummary?: string;
  agentId?: string;
  taskId?: string;
  artifactId?: string;
}

export interface SqlTabState {
  sql: string;
  connectionId: string | null;
  outcome: ExecuteOutcome | null;
  plan: string | null;
  running: boolean;
  savedQueryId: string | null;
}

export type BottomTab = 'activity' | 'results' | 'events' | 'approvals' | 'history';

export interface Toast { id: number; kind: 'info' | 'error' | 'success'; text: string }

interface State {
  ready: boolean;
  live: 'connecting' | 'open' | 'closed';
  workspaces: Workspace[];
  workspaceId: string | null;
  projects: Project[];
  projectId: string | null;
  connections: DatabaseConnection[];
  agents: Agent[];
  tasks: Task[];
  approvals: Approval[];
  artifacts: Artifact[];
  knowledge: KnowledgeEntry[];
  savedQueries: SavedQuery[];
  events: SfEvent[];
  schemas: Record<string, SchemaSnapshot>;
  schemaLoading: Record<string, boolean>;
  tabs: Tab[];
  activeTabId: string;
  selection: Selection;
  sqlTabs: Record<string, SqlTabState>;
  bottomTab: BottomTab;
  bottomOpen: boolean;
  inspectorOpen: boolean;
  sidebarOpen: boolean;
  paletteOpen: boolean;
  toasts: Toast[];
  modal: { kind: 'connection' | 'task' | 'agent' | 'project' | 'knowledge'; params?: Record<string, string> } | null;

  boot(): Promise<void>;
  selectWorkspace(id: string): Promise<void>;
  selectProject(id: string | null): Promise<void>;
  loadProjectData(): Promise<void>;
  reload(entity: 'projects' | 'connections' | 'agents' | 'tasks' | 'approvals' | 'artifacts' | 'knowledge' | 'savedQueries' | 'events'): Promise<void>;
  loadSchema(connectionId: string, refresh?: boolean): Promise<SchemaSnapshot | null>;
  openTab(tab: Omit<Tab, 'id'> & { id?: string }): void;
  closeTab(id: string): void;
  setActiveTab(id: string): void;
  select(patch: Selection): void;
  updateSqlTab(id: string, patch: Partial<SqlTabState>): void;
  newSqlTab(init?: Partial<SqlTabState> & { title?: string }): string;
  setBottom(tab: BottomTab, open?: boolean): void;
  toggle(key: 'bottomOpen' | 'inspectorOpen' | 'sidebarOpen' | 'paletteOpen', value?: boolean): void;
  toast(text: string, kind?: Toast['kind']): void;
  dismissToast(id: number): void;
  setModal(modal: State['modal']): void;
  connectLive(): void;
}

const DASHBOARD: Tab = { id: 'dashboard', kind: 'dashboard', title: 'Dashboard', params: {} };
let toastSeq = 0;
let sqlSeq = 1;

function loadPersisted(): Partial<Pick<State, 'tabs' | 'activeTabId' | 'projectId' | 'workspaceId' | 'sqlTabs' | 'bottomOpen' | 'inspectorOpen' | 'sidebarOpen'>> {
  try {
    const raw = localStorage.getItem('schemaforge.ui');
    if (!raw) return {};
    const p = JSON.parse(raw);
    const sqlTabs: Record<string, SqlTabState> = {};
    for (const [k, v] of Object.entries(p.sqlTabs ?? {})) sqlTabs[k] = { ...(v as SqlTabState), outcome: null, plan: null, running: false };
    const nums = Object.keys(sqlTabs).map((k) => Number(k.replace('sql-', ''))).filter((n) => !Number.isNaN(n));
    if (nums.length) sqlSeq = Math.max(...nums) + 1;
    return { ...p, sqlTabs };
  } catch { return {}; }
}

function persist(s: State): void {
  try {
    const sqlTabs: Record<string, Partial<SqlTabState>> = {};
    for (const [k, v] of Object.entries(s.sqlTabs)) sqlTabs[k] = { sql: v.sql, connectionId: v.connectionId, savedQueryId: v.savedQueryId };
    localStorage.setItem('schemaforge.ui', JSON.stringify({ tabs: s.tabs, activeTabId: s.activeTabId, projectId: s.projectId, workspaceId: s.workspaceId, sqlTabs, bottomOpen: s.bottomOpen, inspectorOpen: s.inspectorOpen, sidebarOpen: s.sidebarOpen }));
  } catch { /* ignore */ }
}

const persisted = loadPersisted();

export const useStore = create<State>((set, get) => ({
  ready: false,
  live: 'connecting',
  workspaces: [], workspaceId: persisted.workspaceId ?? null,
  projects: [], projectId: persisted.projectId ?? null,
  connections: [], agents: [], tasks: [], approvals: [], artifacts: [], knowledge: [], savedQueries: [], events: [],
  schemas: {}, schemaLoading: {},
  tabs: persisted.tabs?.length ? persisted.tabs : [DASHBOARD],
  activeTabId: persisted.activeTabId ?? 'dashboard',
  selection: {},
  sqlTabs: persisted.sqlTabs ?? {},
  bottomTab: 'activity', bottomOpen: persisted.bottomOpen ?? true, inspectorOpen: persisted.inspectorOpen ?? true, sidebarOpen: persisted.sidebarOpen ?? true,
  paletteOpen: false, toasts: [], modal: null,

  async boot() {
    const workspaces = await api.workspaces();
    const workspaceId = workspaces.find((w) => w.id === get().workspaceId)?.id ?? workspaces[0]?.id ?? null;
    set({ workspaces, workspaceId });
    if (workspaceId) {
      const projects = await api.projects(workspaceId);
      const projectId = projects.find((p) => p.id === get().projectId)?.id ?? projects[0]?.id ?? null;
      set({ projects, projectId });
    }
    await get().loadProjectData();
    get().connectLive();
    set({ ready: true });
  },

  async selectWorkspace(id) {
    const projects = await api.projects(id);
    set({ workspaceId: id, projects, projectId: projects[0]?.id ?? null, tabs: [DASHBOARD], activeTabId: 'dashboard', sqlTabs: {} });
    await get().loadProjectData();
  },

  async selectProject(id) {
    set({ projectId: id, selection: {} });
    await get().loadProjectData();
    persist(get());
  },

  async loadProjectData() {
    const { projectId, workspaceId } = get();
    const [connections, agents, tasks, approvals, artifacts, knowledge, savedQueries, events] = await Promise.all([
      projectId ? api.connections(projectId) : Promise.resolve([]),
      api.agents({ workspaceId: workspaceId ?? undefined }),
      projectId ? api.tasks({ projectId }) : Promise.resolve([]),
      api.approvals({ projectId: projectId ?? undefined, status: 'pending' }),
      projectId ? api.artifacts({ projectId }) : Promise.resolve([]),
      projectId ? api.knowledge({ projectId }) : Promise.resolve([]),
      projectId ? api.savedQueries(projectId) : Promise.resolve([]),
      api.events({ workspaceId: workspaceId ?? undefined, limit: 300 }),
    ]);
    set({ connections, agents, tasks, approvals, artifacts, knowledge, savedQueries, events });
    for (const c of connections) if (!get().schemas[c.id]) void get().loadSchema(c.id);
  },

  async reload(entity) {
    const { projectId, workspaceId } = get();
    switch (entity) {
      case 'projects': set({ projects: await api.projects(workspaceId ?? undefined) }); break;
      case 'connections': set({ connections: projectId ? await api.connections(projectId) : [] }); break;
      case 'agents': set({ agents: await api.agents({ workspaceId: workspaceId ?? undefined }) }); break;
      case 'tasks': set({ tasks: projectId ? await api.tasks({ projectId }) : [] }); break;
      case 'approvals': set({ approvals: await api.approvals({ projectId: projectId ?? undefined, status: 'pending' }) }); break;
      case 'artifacts': set({ artifacts: projectId ? await api.artifacts({ projectId }) : [] }); break;
      case 'knowledge': set({ knowledge: projectId ? await api.knowledge({ projectId }) : [] }); break;
      case 'savedQueries': set({ savedQueries: projectId ? await api.savedQueries(projectId) : [] }); break;
      case 'events': set({ events: await api.events({ workspaceId: workspaceId ?? undefined, limit: 300 }) }); break;
    }
  },

  async loadSchema(connectionId, refresh = false) {
    if (get().schemaLoading[connectionId]) return get().schemas[connectionId] ?? null;
    set((s) => ({ schemaLoading: { ...s.schemaLoading, [connectionId]: true } }));
    try {
      const snap = await api.schema(connectionId, refresh);
      set((s) => ({ schemas: { ...s.schemas, [connectionId]: snap } }));
      if (refresh) void get().reload('connections');
      return snap;
    } catch (e) {
      get().toast(`Schema load failed: ${(e as Error).message}`, 'error');
      void get().reload('connections');
      return null;
    } finally {
      set((s) => ({ schemaLoading: { ...s.schemaLoading, [connectionId]: false } }));
    }
  },

  openTab(tab) {
    const id = tab.id ?? `${tab.kind}:${Object.values(tab.params).join(':')}`;
    set((s) => {
      const exists = s.tabs.find((t) => t.id === id);
      const tabs = exists ? s.tabs.map((t) => (t.id === id ? { ...t, title: tab.title, params: tab.params } : t)) : [...s.tabs, { ...tab, id }];
      return { tabs, activeTabId: id };
    });
    persist(get());
  },

  closeTab(id) {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      const tabs = s.tabs.filter((t) => t.id !== id);
      let activeTabId = s.activeTabId;
      if (activeTabId === id) activeTabId = tabs[Math.max(0, idx - 1)]?.id ?? tabs[0]?.id ?? 'dashboard';
      const sqlTabs = { ...s.sqlTabs };
      delete sqlTabs[id];
      return { tabs: tabs.length ? tabs : [DASHBOARD], activeTabId, sqlTabs };
    });
    persist(get());
  },

  setActiveTab(id) {
    set({ activeTabId: id });
    persist(get());
  },

  select(patch) {
    set((s) => ({ selection: { ...s.selection, ...patch } }));
  },

  updateSqlTab(id, patch) {
    set((s) => ({ sqlTabs: { ...s.sqlTabs, [id]: { ...(s.sqlTabs[id] ?? { sql: '', connectionId: null, outcome: null, plan: null, running: false, savedQueryId: null }), ...patch } } }));
    if (patch.sql !== undefined || patch.connectionId !== undefined) persist(get());
  },

  newSqlTab(init) {
    const id = `sql-${sqlSeq++}`;
    const connectionId = init?.connectionId ?? get().selection.connectionId ?? get().connections[0]?.id ?? null;
    set((s) => ({ sqlTabs: { ...s.sqlTabs, [id]: { sql: init?.sql ?? '', connectionId, outcome: null, plan: null, running: false, savedQueryId: init?.savedQueryId ?? null } } }));
    get().openTab({ id, kind: 'sql', title: init?.title ?? `Query ${id.replace('sql-', '')}`, params: {} });
    return id;
  },

  setBottom(tab, open = true) {
    set({ bottomTab: tab, bottomOpen: open });
    persist(get());
  },

  toggle(key, value) {
    set((s) => ({ [key]: value ?? !s[key] }));
    persist(get());
  },

  toast(text, kind = 'info') {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 8000 : 4000);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  setModal(modal) {
    set({ modal });
  },

  connectLive() {
    const pending = new Map<string, ReturnType<typeof setTimeout>>();
    const schedule = (entity: Parameters<State['reload']>[0]) => {
      if (pending.has(entity)) return;
      pending.set(entity, setTimeout(() => { pending.delete(entity); void get().reload(entity); }, 120));
    };
    const open = () => {
      const lastSeq = get().events.at(-1)?.seq ?? 0;
      const es = new EventSource(`/api/events/stream?afterSeq=${lastSeq}`);
      es.addEventListener('ready', () => set({ live: 'open' }));
      es.addEventListener('event', (m) => {
        const e = JSON.parse((m as MessageEvent).data) as SfEvent;
        set((s) => (s.events.some((x) => x.seq === e.seq) ? {} : { events: [...s.events, e].slice(-1000) }));
        if (e.type === 'sql.executed' || e.type === 'connection.updated') schedule('connections');
        if (e.type === 'approval.requested' || e.type === 'approval.resolved') schedule('approvals');
      });
      es.addEventListener('change', (m) => {
        const ch = JSON.parse((m as MessageEvent).data) as { entity: string };
        const map: Record<string, Parameters<State['reload']>[0]> = { task: 'tasks', agent: 'agents', approval: 'approvals', artifact: 'artifacts', connection: 'connections', project: 'projects', knowledge: 'knowledge' };
        const target = map[ch.entity];
        if (target) schedule(target);
      });
      es.onerror = () => {
        set({ live: 'closed' });
        es.close();
        setTimeout(open, 2000);
      };
    };
    open();
  },
}));

// ---------- selectors / helpers ----------

export const useProject = () => useStore((s) => s.projects.find((p) => p.id === s.projectId) ?? null);
export const useActiveTab = () => useStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? s.tabs[0]);

export function openTable(connectionId: string, schema: string, name: string): void {
  const st = useStore.getState();
  st.select({ connectionId, table: { schema, name } });
  st.openTab({ kind: 'table', title: name, params: { connectionId, schema, name } });
}

export function openAgent(agentId: string): void {
  const st = useStore.getState();
  const a = st.agents.find((x) => x.id === agentId);
  st.select({ agentId });
  st.openTab({ kind: 'agent', title: a?.name ?? 'Agent', params: { agentId } });
}

export function openTask(taskId: string): void {
  const st = useStore.getState();
  const t = st.tasks.find((x) => x.id === taskId);
  st.select({ taskId, agentId: t?.agentId ?? st.selection.agentId });
  st.openTab({ kind: 'task', title: t ? t.title.slice(0, 28) + (t.title.length > 28 ? '…' : '') : 'Task', params: { taskId } });
}

export function openArtifact(artifactId: string): void {
  const st = useStore.getState();
  const a = st.artifacts.find((x) => x.id === artifactId);
  st.select({ artifactId });
  st.openTab({ kind: 'artifact', title: a ? a.title.slice(0, 28) : 'Artifact', params: { artifactId } });
}

export function openDiagram(connectionId: string, focus?: string): void {
  const st = useStore.getState();
  const c = st.connections.find((x) => x.id === connectionId);
  st.select({ connectionId });
  st.openTab({ id: `diagram:${connectionId}`, kind: 'diagram', title: `Diagram · ${c?.name ?? ''}`, params: { connectionId, ...(focus ? { focus } : {}) } });
}

export function openSql(sql: string, connectionId?: string | null, title?: string, savedQueryId?: string | null): string {
  return useStore.getState().newSqlTab({ sql, connectionId: connectionId ?? undefined, title, savedQueryId: savedQueryId ?? null });
}
