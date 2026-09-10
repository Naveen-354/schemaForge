import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ChevronDown, ChevronRight, Database, Table2, Eye, Bot, ListTodo, Package, BookOpen, Plus, RefreshCw, GitBranch, KeyRound, Columns3, FunctionSquare, Zap, Boxes, Search } from 'lucide-react';
import type { DatabaseConnection, SchemaSnapshot, TableInfo } from '@schemaforge/shared';
import { openAgent, openArtifact, openDiagram, openTable, openTask, useStore } from '../store';
import { Badge, StatusDot, timeAgo } from './ui';

function Section({ title, icon, count, children, actions, defaultOpen = true }: { title: string; icon: React.ReactNode; count?: number; children: React.ReactNode; actions?: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="sidebar-section">
      <div className="section-title" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{icon}{title}
        {count !== undefined && <span className="count">{count}</span>}
        <span onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex' }}>{actions}</span>
      </div>
      {open && <div className="tree">{children}</div>}
    </div>
  );
}

function TableNode({ conn, t, snap }: { conn: DatabaseConnection; t: TableInfo; snap: SchemaSnapshot }) {
  const [open, setOpen] = useState(false);
  const sel = useStore((s) => s.selection.table?.name === t.name && s.selection.table?.schema === t.schema && s.selection.connectionId === conn.id);
  const referencedBy = useMemo(() => snap.tables.filter((x) => x.foreignKeys.some((fk) => fk.refTable === t.name)).length, [snap, t.name]);
  return (
    <>
      <div className={`tree-item ${sel ? 'selected' : ''}`} style={{ paddingLeft: 26 }} onClick={() => openTable(conn.id, t.schema, t.name)} title={`${t.schema}.${t.name}`}>
        <span onClick={(e) => { e.stopPropagation(); setOpen(!open); }} style={{ display: 'inline-flex', width: 12 }}>{open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</span>
        {t.kind === 'table' ? <Table2 size={12} /> : <Eye size={12} />}
        <span className="label">{t.name}</span>
        <span className="muted">{t.rowEstimate != null ? t.rowEstimate.toLocaleString() : ''}</span>
      </div>
      {open && (
        <div>
          <div className="tree-item" style={{ paddingLeft: 44 }} onClick={() => openTable(conn.id, t.schema, t.name)}><Columns3 size={11} /> Columns <span className="muted">{t.columns.length}</span></div>
          {t.columns.map((c) => (
            <div key={c.name} className="tree-item" style={{ paddingLeft: 58 }} onClick={() => openTable(conn.id, t.schema, t.name)} title={`${c.name} ${c.dataType}${c.nullable ? '' : ' NOT NULL'}`}>
              {c.isPrimaryKey ? <KeyRound size={10} style={{ color: 'var(--yellow)' }} /> : t.foreignKeys.some((fk) => fk.columns.includes(c.name)) ? <GitBranch size={10} style={{ color: 'var(--cyan)' }} /> : <span style={{ width: 10 }} />}
              <span className="label">{c.name}</span><span className="muted mono">{c.dataType}</span>
            </div>
          ))}
          {t.foreignKeys.length > 0 && <div className="tree-item" style={{ paddingLeft: 44 }} onClick={() => openDiagram(conn.id, `${t.schema}.${t.name}`)}><GitBranch size={11} /> Foreign keys <span className="muted">{t.foreignKeys.length} out · {referencedBy} in</span></div>}
          {t.indexes.length > 0 && <div className="tree-item" style={{ paddingLeft: 44 }} onClick={() => openTable(conn.id, t.schema, t.name)}><Zap size={11} /> Indexes <span className="muted">{t.indexes.length}</span></div>}
        </div>
      )}
    </>
  );
}

function ConnectionNode({ conn }: { conn: DatabaseConnection }) {
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState('');
  const snap = useStore((s) => s.schemas[conn.id]);
  const loading = useStore((s) => s.schemaLoading[conn.id]);
  const selected = useStore((s) => s.selection.connectionId === conn.id);
  const st = useStore.getState;
  const tables = useMemo(() => (snap?.tables ?? []).filter((t) => !filter || t.name.toLowerCase().includes(filter.toLowerCase())), [snap, filter]);
  const bySchema = useMemo(() => {
    const m = new Map<string, TableInfo[]>();
    for (const t of tables) m.set(t.schema, [...(m.get(t.schema) ?? []), t]);
    return [...m.entries()];
  }, [tables]);
  const color = conn.status === 'connected' ? 'var(--green)' : conn.status === 'error' ? 'var(--red)' : 'var(--fg-3)';
  return (
    <>
      <div className={`tree-item ${selected ? 'selected' : ''}`} onClick={() => { setOpen(!open); st().select({ connectionId: conn.id }); st().openTab({ kind: 'connection', title: conn.name, params: { connectionId: conn.id } }); }} title={conn.lastError ?? `${conn.engine} · ${conn.database}`}>
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span className="status-dot" style={{ background: color }} />
        <Database size={12} /><span className="label">{conn.name}</span>
        <span className="muted">{snap ? `${snap.tables.length}` : loading ? '…' : ''}</span>
      </div>
      {open && (
        <div>
          <div className="row" style={{ padding: '2px 8px 2px 26px', gap: 4 }}>
            <input className="input sm grow" placeholder="Filter tables" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button className="btn ghost sm icon" title="Refresh schema" onClick={() => void st().loadSchema(conn.id, true)}><RefreshCw size={12} className={loading ? 'pulse' : ''} /></button>
            <button className="btn ghost sm icon" title="Diagram" onClick={() => openDiagram(conn.id)}><Boxes size={12} /></button>
          </div>
          {!snap && !loading && <div className="tree-item" style={{ paddingLeft: 26 }} onClick={() => void st().loadSchema(conn.id, true)}>{conn.status === 'error' ? <span style={{ color: 'var(--red)' }}>Connection error · retry</span> : 'Load schema'}</div>}
          {bySchema.map(([schema, ts]) => (
            <div key={schema}>
              {bySchema.length > 1 && <div className="tree-item dim" style={{ paddingLeft: 20 }}><Boxes size={11} /> {schema} <span className="muted">{ts.length}</span></div>}
              {ts.map((t) => <TableNode key={`${t.schema}.${t.name}`} conn={conn} t={t} snap={snap!} />)}
            </div>
          ))}
          {snap && snap.routines.length > 0 && (
            <div className="tree-item dim" style={{ paddingLeft: 26 }} onClick={() => st().openTab({ kind: 'connection', title: conn.name, params: { connectionId: conn.id, tab: 'routines' } })}><FunctionSquare size={11} /> Functions & procedures <span className="muted">{snap.routines.length}</span></div>
          )}
          {snap && snap.triggers.length > 0 && (
            <div className="tree-item dim" style={{ paddingLeft: 26 }} onClick={() => st().openTab({ kind: 'connection', title: conn.name, params: { connectionId: conn.id, tab: 'triggers' } })}><Zap size={11} /> Triggers <span className="muted">{snap.triggers.length}</span></div>
          )}
        </div>
      )}
    </>
  );
}

export function Sidebar() {
  const { connections, agents, tasks, artifacts, knowledge, projectId, selection } = useStore(useShallow((s) => ({
    connections: s.connections, agents: s.agents, tasks: s.tasks, artifacts: s.artifacts, knowledge: s.knowledge, projectId: s.projectId, selection: s.selection,
  })));
  const st = useStore.getState;
  const activeTasks = tasks.filter((t) => !['COMPLETED', 'CANCELLED'].includes(t.status)).slice(0, 25);
  const visibleAgents = agents.filter((a) => !a.projectId || a.projectId === projectId);
  return (
    <div className="panel-body">
      <Section title="Databases" icon={<Database size={12} />} count={connections.length} actions={<button className="action" title="Add connection" onClick={() => st().setModal({ kind: 'connection' })}><Plus size={12} /></button>}>
        {connections.length === 0 && <div className="tree-item dim" onClick={() => st().setModal({ kind: 'connection' })}><Plus size={12} /> Add a database connection</div>}
        {connections.map((c) => <ConnectionNode key={c.id} conn={c} />)}
      </Section>
      <Section title="Agents" icon={<Bot size={12} />} count={visibleAgents.length} actions={<><button className="action" title="Agent dashboard" onClick={() => st().openTab({ id: 'agents', kind: 'agents', title: 'Agents', params: {} })}><Search size={12} /></button><button className="action" title="New agent" onClick={() => st().setModal({ kind: 'agent' })}><Plus size={12} /></button></>}>
        {visibleAgents.map((a) => (
          <div key={a.id} className={`tree-item ${selection.agentId === a.id ? 'selected' : ''}`} onClick={() => openAgent(a.id)} title={a.statusMessage ?? a.role}>
            <StatusDot status={a.status} /><span className="label">{a.name}</span>
            <span className="muted ellipsis" style={{ maxWidth: 110 }}>{a.status === 'RUNNING' || a.status === 'WAITING_FOR_APPROVAL' ? a.statusMessage : a.status.toLowerCase()}</span>
          </div>
        ))}
      </Section>
      <Section title="Tasks" icon={<ListTodo size={12} />} count={activeTasks.length} actions={<><button className="action" title="All tasks" onClick={() => st().openTab({ id: 'tasks', kind: 'tasks', title: 'Tasks', params: {} })}><Search size={12} /></button><button className="action" title="New task" onClick={() => st().setModal({ kind: 'task' })}><Plus size={12} /></button></>}>
        {activeTasks.length === 0 && <div className="tree-item dim" onClick={() => st().setModal({ kind: 'task' })}><Plus size={12} /> Create a task</div>}
        {activeTasks.map((t) => (
          <div key={t.id} className={`tree-item ${selection.taskId === t.id ? 'selected' : ''}`} onClick={() => openTask(t.id)} title={t.title}>
            <StatusDot status={t.status} /><span className="label">{t.title}</span>
            <Badge status={t.status} className="small">{t.status === 'WAITING_FOR_APPROVAL' ? 'APPROVAL' : t.status}</Badge>
          </div>
        ))}
      </Section>
      <Section title="Artifacts" icon={<Package size={12} />} count={artifacts.length} actions={<button className="action" title="All artifacts" onClick={() => st().openTab({ id: 'artifacts', kind: 'artifacts', title: 'Artifacts', params: {} })}><Search size={12} /></button>} defaultOpen={false}>
        {artifacts.slice(0, 20).map((a) => (
          <div key={a.id} className={`tree-item ${selection.artifactId === a.id ? 'selected' : ''}`} onClick={() => openArtifact(a.id)} title={a.title}>
            <Package size={11} /><span className="label">{a.title}</span><span className="muted">{a.type}</span>
          </div>
        ))}
      </Section>
      <Section title="Knowledge" icon={<BookOpen size={12} />} count={knowledge.length} actions={<button className="action" title="Open knowledge" onClick={() => st().openTab({ id: 'knowledge', kind: 'knowledge', title: 'Knowledge', params: {} })}><Search size={12} /></button>} defaultOpen={false}>
        {knowledge.slice(0, 15).map((k) => (
          <div key={k.id} className="tree-item" onClick={() => st().openTab({ id: 'knowledge', kind: 'knowledge', title: 'Knowledge', params: { focus: k.id } })} title={k.content}>
            <BookOpen size={11} /><span className="label">{k.title}</span><span className="muted">{timeAgo(k.updatedAt)}</span>
          </div>
        ))}
      </Section>
    </div>
  );
}
