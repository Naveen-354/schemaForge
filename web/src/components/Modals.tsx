import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { AgentPermissions, PermissionDecision, ProviderId } from '@schemaforge/shared';
import { api } from '../api';
import { openAgent, openTask, useStore } from '../store';

function Modal({ title, children, footer, onClose }: { title: string; children: React.ReactNode; footer: React.ReactNode; onClose(): void }) {
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">{title}<span className="grow" /><button className="btn ghost sm icon" onClick={onClose}><X size={14} /></button></div>
        <div className="modal-body">{children}</div>
        <div className="modal-footer">{footer}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="field"><label>{label}</label>{children}</div>;
}

function ConnectionModal({ onClose }: { onClose(): void }) {
  const projectId = useStore((s) => s.projectId)!;
  const st = useStore.getState;
  const [f, setF] = useState({ name: '', engine: 'postgres' as 'postgres' | 'sqlite', host: 'localhost', port: '5432', database: '', username: 'postgres', password: '', ssl: false, filePath: '', schemas: '', readOnly: false });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const conn = await api.createConnection({
        projectId, name: f.name || f.database || f.filePath.split(/[\\/]/).pop() || 'database', engine: f.engine,
        host: f.engine === 'postgres' ? f.host : undefined, port: f.engine === 'postgres' ? Number(f.port) : undefined,
        database: f.engine === 'postgres' ? f.database : (f.filePath.split(/[\\/]/).pop() ?? 'sqlite'), username: f.engine === 'postgres' ? f.username : undefined,
        password: f.engine === 'postgres' && f.password ? f.password : undefined, ssl: f.ssl, filePath: f.engine === 'sqlite' ? f.filePath : undefined,
        schemas: f.schemas.split(',').map((s) => s.trim()).filter(Boolean), readOnly: f.readOnly,
      });
      st().toast(`Connection "${conn.name}" created; testing…`, 'success');
      await st().reload('connections');
      onClose();
      setTimeout(() => void st().loadSchema(conn.id, true), 800);
    } catch (e) { st().toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add database connection" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={() => void submit()}>Create & test</button></>}>
      <div className="grid cols-2">
        <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. mf-platform (local)" /></Field>
        <Field label="Engine"><select className="select" value={f.engine} onChange={(e) => setF({ ...f, engine: e.target.value as 'postgres' | 'sqlite', port: e.target.value === 'postgres' ? '5432' : '' })}><option value="postgres">PostgreSQL</option><option value="sqlite">SQLite (file)</option></select></Field>
      </div>
      {f.engine === 'postgres' ? (
        <>
          <div className="grid cols-3">
            <Field label="Host"><input className="input" value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} /></Field>
            <Field label="Port"><input className="input" value={f.port} onChange={(e) => setF({ ...f, port: e.target.value })} /></Field>
            <Field label="Database"><input className="input" value={f.database} onChange={(e) => setF({ ...f, database: e.target.value })} /></Field>
          </div>
          <div className="grid cols-2">
            <Field label="Username"><input className="input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
            <Field label="Password (stored encrypted, never sent to AI)"><input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          </div>
          <Field label="Schemas (comma separated, blank = all non-system)"><input className="input" value={f.schemas} onChange={(e) => setF({ ...f, schemas: e.target.value })} placeholder="public" /></Field>
          <label className="row small"><input type="checkbox" checked={f.ssl} onChange={(e) => setF({ ...f, ssl: e.target.checked })} /> Use SSL</label>
        </>
      ) : (
        <Field label="SQLite file path"><input className="input" value={f.filePath} onChange={(e) => setF({ ...f, filePath: e.target.value })} placeholder="C:\\data\\app.db" /></Field>
      )}
      <label className="row small"><input type="checkbox" checked={f.readOnly} onChange={(e) => setF({ ...f, readOnly: e.target.checked })} /> Read-only (reject all writes/DDL at the connection level)</label>
    </Modal>
  );
}

function TaskModal({ onClose, params }: { onClose(): void; params?: Record<string, string> }) {
  const { projectId, agents, connections, tasks, selection } = useStore.getState();
  const st = useStore.getState;
  const visibleAgents = agents.filter((a) => !a.projectId || a.projectId === projectId);
  const [f, setF] = useState({ title: params?.title ?? '', description: '', agentId: params?.agentId ?? visibleAgents.find((a) => /database/i.test(a.name))?.id ?? visibleAgents[0]?.id ?? '', connectionId: selection.connectionId ?? connections[0]?.id ?? '', priority: 'normal', dependsOn: [] as string[], start: true, useTable: !!selection.table, useSql: !!selection.sql });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!projectId || !f.title.trim()) return;
    setBusy(true);
    try {
      const t = await api.createTask({
        projectId, title: f.title.trim(), description: f.description, agentId: f.agentId || null, connectionId: f.connectionId || null, priority: f.priority as 'normal',
        dependsOn: f.dependsOn, start: f.start && !!f.agentId, context: { table: f.useTable ? selection.table : undefined, sql: f.useSql ? selection.sql : undefined },
      });
      st().toast(f.start ? 'Task queued' : 'Task created', 'success');
      await st().reload('tasks');
      onClose();
      openTask(t.id);
    } catch (e) { st().toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title="New task" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !f.title.trim()} onClick={() => void submit()}>{f.start ? 'Create & start' : 'Create'}</button></>}>
      <Field label="Objective"><input className="input" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Review the customer schema and identify normalization problems" /></Field>
      <Field label="Details (optional)"><textarea className="textarea" style={{ fontFamily: 'var(--sans)' }} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="grid cols-3">
        <Field label="Agent"><select className="select" value={f.agentId} onChange={(e) => setF({ ...f, agentId: e.target.value })}><option value="">Unassigned</option>{visibleAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Database"><select className="select" value={f.connectionId} onChange={(e) => setF({ ...f, connectionId: e.target.value })}><option value="">None</option>{connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Priority"><select className="select" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option>low</option><option>normal</option><option>high</option><option>urgent</option></select></Field>
      </div>
      <Field label="Depends on (runs after these complete)">
        <select className="select" multiple size={4} value={f.dependsOn} onChange={(e) => setF({ ...f, dependsOn: [...e.target.selectedOptions].map((o) => o.value) })}>
          {tasks.filter((t) => t.context.kind !== 'chat').slice(0, 40).map((t) => <option key={t.id} value={t.id}>[{t.status}] {t.title}</option>)}
        </select>
      </Field>
      <div className="row wrap small">
        {selection.table && <label className="row"><input type="checkbox" checked={f.useTable} onChange={(e) => setF({ ...f, useTable: e.target.checked })} /> attach selected table ({selection.table.name})</label>}
        {selection.sql && <label className="row"><input type="checkbox" checked={f.useSql} onChange={(e) => setF({ ...f, useSql: e.target.checked })} /> attach selected SQL</label>}
        <label className="row"><input type="checkbox" checked={f.start} onChange={(e) => setF({ ...f, start: e.target.checked })} /> start immediately</label>
      </div>
    </Modal>
  );
}

const DECISIONS: PermissionDecision[] = ['allow', 'ask', 'deny'];

export function PermissionEditor({ value, onChange, tools }: { value: AgentPermissions; onChange(p: AgentPermissions): void; tools: { name: string; risk: string }[] }) {
  return (
    <div className="col">
      <div>
        <div className="small dim" style={{ marginBottom: 4 }}>SQL policy by risk class</div>
        <div className="grid cols-2">
          {(['safe', 'write', 'ddl', 'destructive'] as const).map((k) => (
            <label key={k} className="row small"><span style={{ width: 80 }}>{k}</span>
              <select className="select" value={value.sql[k]} onChange={(e) => onChange({ ...value, sql: { ...value.sql, [k]: e.target.value as PermissionDecision } })}>{DECISIONS.map((d) => <option key={d}>{d}</option>)}</select>
            </label>
          ))}
        </div>
      </div>
      <div>
        <div className="small dim" style={{ marginBottom: 4 }}>Tool overrides (blank = default: read tools allow, write/exec tools ask)</div>
        <div className="grid cols-2">
          {tools.filter((t) => t.name !== 'run_sql').map((t) => (
            <label key={t.name} className="row small"><span className="mono ellipsis" style={{ width: 120 }} title={t.risk}>{t.name}</span>
              <select className="select" value={value.tools[t.name] ?? ''} onChange={(e) => { const tools = { ...value.tools }; if (e.target.value) tools[t.name] = e.target.value as PermissionDecision; else delete tools[t.name]; onChange({ ...value, tools }); }}>
                <option value="">default</option>{DECISIONS.map((d) => <option key={d}>{d}</option>)}
              </select>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

const ROLE_PRESETS: Record<string, { role: string; instructions: string; sql: AgentPermissions['sql'] }> = {
  'Database Agent': { role: 'database engineer', instructions: 'Inspect schemas, analyze indexes and constraints, write SQL and migrations. Save deliverables as artifacts.', sql: { safe: 'allow', write: 'ask', ddl: 'ask', destructive: 'deny' } },
  'Architect Agent': { role: 'software architect', instructions: 'Review database designs for normalization, naming, relationships and evolution. Produce architecture decision artifacts.', sql: { safe: 'allow', write: 'deny', ddl: 'deny', destructive: 'deny' } },
  'Backend Agent': { role: 'backend engineer', instructions: 'Implement repository/service code that matches the database schema. Read the codebase before changing it and keep changes minimal.', sql: { safe: 'allow', write: 'deny', ddl: 'deny', destructive: 'deny' } },
  'Research Agent': { role: 'researcher', instructions: 'Gather facts from the schema, code and project knowledge. Produce research artifacts with sources; do not modify anything.', sql: { safe: 'allow', write: 'deny', ddl: 'deny', destructive: 'deny' } },
  'Testing Agent': { role: 'test engineer', instructions: 'Validate migrations and queries with dry runs and test commands. Report results as test-result artifacts.', sql: { safe: 'allow', write: 'ask', ddl: 'deny', destructive: 'deny' } },
  'Security Agent': { role: 'security reviewer', instructions: 'Identify sensitive columns (PII, credentials), missing constraints and risky access patterns. Never export data.', sql: { safe: 'allow', write: 'deny', ddl: 'deny', destructive: 'deny' } },
  'Code Review Agent': { role: 'code and schema reviewer', instructions: 'Combine upstream artifacts into a consolidated review with prioritized recommendations.', sql: { safe: 'allow', write: 'deny', ddl: 'deny', destructive: 'deny' } },
  'Documentation Agent': { role: 'technical writer', instructions: 'Document tables, relationships and business rules as markdown artifacts and save reusable facts to knowledge.', sql: { safe: 'allow', write: 'deny', ddl: 'deny', destructive: 'deny' } },
};

function AgentModal({ onClose }: { onClose(): void }) {
  const { workspaceId, projectId } = useStore.getState();
  const st = useStore.getState;
  const [providers, setProviders] = useState<{ id: ProviderId; name: string; configured: boolean; defaultModel: string; models: string[] }[]>([]);
  const [tools, setTools] = useState<{ name: string; risk: string }[]>([]);
  const [f, setF] = useState({ name: '', role: '', instructions: '', provider: 'heuristic' as ProviderId, model: 'heuristic-v1', projectScoped: false, maxIterations: 20 });
  const [perms, setPerms] = useState<AgentPermissions>({ tools: {}, defaultTool: 'allow', sql: { safe: 'allow', write: 'ask', ddl: 'ask', destructive: 'deny' } });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api.settings().then((s) => {
      setProviders(s.providers);
      const best = s.providers.find((p) => p.id === 'anthropic' && p.configured) ?? s.providers.find((p) => p.configured && p.id !== 'heuristic') ?? s.providers.find((p) => p.id === 'heuristic');
      if (best) setF((x) => ({ ...x, provider: best.id, model: best.defaultModel }));
    });
    void api.agentTools().then(setTools);
  }, []);
  const applyPreset = (name: string) => {
    const p = ROLE_PRESETS[name];
    if (!p) return;
    setF({ ...f, name, role: p.role, instructions: p.instructions });
    setPerms({ ...perms, sql: p.sql });
  };
  const submit = async () => {
    if (!f.name.trim() || !workspaceId) return;
    setBusy(true);
    try {
      const a = await api.createAgent({ workspaceId, projectId: f.projectScoped ? projectId : null, name: f.name.trim(), role: f.role || 'agent', instructions: f.instructions, provider: f.provider, model: f.model, permissions: perms, maxIterations: f.maxIterations });
      st().toast(`Agent "${a.name}" created`, 'success');
      await st().reload('agents');
      onClose();
      openAgent(a.id);
    } catch (e) { st().toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  const prov = providers.find((p) => p.id === f.provider);
  return (
    <Modal title="Create agent" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !f.name.trim()} onClick={() => void submit()}>Create</button></>}>
      <Field label="Preset"><select className="select" value="" onChange={(e) => applyPreset(e.target.value)}><option value="">Choose a preset…</option>{Object.keys(ROLE_PRESETS).map((k) => <option key={k}>{k}</option>)}</select></Field>
      <div className="grid cols-2">
        <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Role"><input className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="database engineer" /></Field>
      </div>
      <Field label="Instructions"><textarea className="textarea" style={{ fontFamily: 'var(--sans)' }} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></Field>
      <div className="grid cols-3">
        <Field label="Provider">
          <select className="select" value={f.provider} onChange={(e) => { const p = providers.find((x) => x.id === e.target.value); setF({ ...f, provider: e.target.value as ProviderId, model: p?.defaultModel ?? f.model }); }}>
            {providers.map((p) => <option key={p.id} value={p.id} disabled={!p.configured}>{p.name}{p.configured ? '' : ' (not configured)'}</option>)}
          </select>
        </Field>
        <Field label="Model"><input className="input" list="models" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} /><datalist id="models">{(prov?.models ?? []).map((m) => <option key={m} value={m} />)}</datalist></Field>
        <Field label="Max steps"><input className="input" type="number" value={f.maxIterations} onChange={(e) => setF({ ...f, maxIterations: Number(e.target.value) })} /></Field>
      </div>
      <label className="row small"><input type="checkbox" checked={f.projectScoped} onChange={(e) => setF({ ...f, projectScoped: e.target.checked })} /> Only available in the current project</label>
      <PermissionEditor value={perms} onChange={setPerms} tools={tools} />
    </Modal>
  );
}

function ProjectModal({ onClose }: { onClose(): void }) {
  const workspaceId = useStore((s) => s.workspaceId)!;
  const st = useStore.getState;
  const [f, setF] = useState({ name: '', description: '', rootPath: '', instructions: '' });
  const submit = async () => {
    try {
      const p = await api.createProject({ workspaceId, name: f.name, description: f.description, rootPath: f.rootPath || null, instructions: f.instructions });
      await st().reload('projects');
      await st().selectProject(p.id);
      onClose();
    } catch (e) { st().toast((e as Error).message, 'error'); }
  };
  return (
    <Modal title="New project" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!f.name.trim()} onClick={() => void submit()}>Create</button></>}>
      <Field label="Name"><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Description"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Source code root path (enables file/git tools)"><input className="input" value={f.rootPath} onChange={(e) => setF({ ...f, rootPath: e.target.value })} placeholder="D:\\code\\my-app" /></Field>
      <Field label="Project instructions for agents"><textarea className="textarea" style={{ fontFamily: 'var(--sans)' }} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} placeholder="Conventions, constraints, things agents must know." /></Field>
    </Modal>
  );
}

function KnowledgeModal({ onClose }: { onClose(): void }) {
  const projectId = useStore((s) => s.projectId)!;
  const st = useStore.getState;
  const [f, setF] = useState({ category: 'convention', title: '', content: '', tags: '' });
  const submit = async () => {
    try {
      await api.createKnowledge({ projectId, category: f.category, title: f.title, content: f.content, tags: f.tags.split(',').map((s) => s.trim()).filter(Boolean) });
      await st().reload('knowledge');
      onClose();
    } catch (e) { st().toast((e as Error).message, 'error'); }
  };
  return (
    <Modal title="Add project knowledge" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!f.title.trim() || !f.content.trim()} onClick={() => void submit()}>Save</button></>}>
      <div className="grid cols-2">
        <Field label="Category"><select className="select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{['convention', 'decision', 'relationship', 'business-rule', 'migration-rule', 'api-contract', 'known-problem', 'research', 'note'].map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Tags (comma separated)"><input className="input" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></Field>
      </div>
      <Field label="Title"><input className="input" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Content"><textarea className="textarea" style={{ fontFamily: 'var(--sans)' }} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} /></Field>
    </Modal>
  );
}

export function Modals() {
  const modal = useStore((s) => s.modal);
  const close = () => useStore.getState().setModal(null);
  if (!modal) return null;
  switch (modal.kind) {
    case 'connection': return <ConnectionModal onClose={close} />;
    case 'task': return <TaskModal onClose={close} params={modal.params} />;
    case 'agent': return <AgentModal onClose={close} />;
    case 'project': return <ProjectModal onClose={close} />;
    case 'knowledge': return <KnowledgeModal onClose={close} />;
  }
}
