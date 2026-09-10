import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Activity, Table, ShieldAlert, History, Bot, X, Check, XCircle, Play } from 'lucide-react';
import type { QueryHistoryEntry } from '@schemaforge/shared';
import { api } from '../api';
import { openAgent, openSql, openTask, useStore, useActiveTab, type BottomTab } from '../store';
import { EventList } from './EventList';
import { Badge, clock, fmtMs, timeAgo } from './ui';
import { ResultsTable } from '../views/ResultsTable';

function ActivityTab() {
  const { events, projectId, agents } = useStore(useShallow((s) => ({ events: s.events, projectId: s.projectId, agents: s.agents })));
  const [type, setType] = useState('');
  const [level, setLevel] = useState('');
  const [agentId, setAgentId] = useState('');
  const [text, setText] = useState('');
  const filtered = useMemo(() => events.filter((e) =>
    (!projectId || !e.projectId || e.projectId === projectId) &&
    (!type || (type.endsWith('.*') ? e.type.startsWith(type.slice(0, -1)) : e.type === type)) &&
    (!level || e.level === level) && (!agentId || e.agentId === agentId) &&
    (!text || e.message.toLowerCase().includes(text.toLowerCase())),
  ), [events, projectId, type, level, agentId, text]);
  return (
    <>
      <div className="filterbar">
        <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          <option value="task.*">Tasks</option><option value="agent.*">Agents</option><option value="tool.*">Tools</option><option value="sql.executed">SQL</option>
          <option value="approval.*">Approvals</option><option value="artifact.created">Artifacts</option><option value="ai.usage">AI usage</option><option value="connection.updated">Connections</option>
        </select>
        <select className="select" value={level} onChange={(e) => setLevel(e.target.value)}><option value="">All levels</option><option value="info">info</option><option value="warn">warn</option><option value="error">error</option></select>
        <select className="select" value={agentId} onChange={(e) => setAgentId(e.target.value)}><option value="">All agents</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <input className="input" placeholder="Filter text" value={text} onChange={(e) => setText(e.target.value)} />
        <span className="muted small">{filtered.length} events</span>
      </div>
      <EventList events={filtered} />
    </>
  );
}

function ResultsTab() {
  const active = useActiveTab();
  const sqlTab = useStore((s) => (active?.kind === 'sql' ? s.sqlTabs[active.id] : undefined));
  const lastSqlTab = useStore((s) => Object.entries(s.sqlTabs).find(([, v]) => v.outcome)?.[1]);
  const t = sqlTab?.outcome || sqlTab?.plan ? sqlTab : lastSqlTab;
  if (!t) return <div className="empty">Run a query to see results here (Ctrl+Enter in the SQL editor).</div>;
  if (t.plan && !t.outcome) return <pre className="panel-body mono" style={{ margin: 0, padding: 10, whiteSpace: 'pre' }}>{t.plan}</pre>;
  const o = t.outcome!;
  if (o.error) return <div className="panel-body pad"><Badge status="error">SQL error</Badge> <span style={{ whiteSpace: 'pre-wrap' }}>{o.error}</span></div>;
  return <ResultsTable result={o.result!} />;
}

function ApprovalsTab() {
  const { approvals, agents, tasks } = useStore(useShallow((s) => ({ approvals: s.approvals, agents: s.agents, tasks: s.tasks })));
  const [notes, setNotes] = useState<Record<string, string>>({});
  const st = useStore.getState;
  const act = async (id: string, approve: boolean) => {
    try {
      if (approve) await api.approve(id, notes[id]); else await api.reject(id, notes[id]);
      st().toast(approve ? 'Approved' : 'Rejected', approve ? 'success' : 'info');
      void st().reload('approvals');
    } catch (e) { st().toast((e as Error).message, 'error'); }
  };
  if (approvals.length === 0) return <div className="empty">No pending approvals. Agents will ask here before risky actions.</div>;
  return (
    <div className="panel-body pad">
      {approvals.map((a) => {
        const agent = agents.find((x) => x.id === a.agentId);
        const task = tasks.find((x) => x.id === a.taskId);
        return (
          <div className="approval-card" key={a.id}>
            <div className="row">
              <ShieldAlert size={14} style={{ color: 'var(--yellow)' }} />
              <strong>{agent?.name ?? 'Agent'}</strong> wants to run <code>{a.toolName}</code>
              <Badge status={/destructive/.test(a.risk) ? 'destructive' : /write|ddl/.test(a.risk) ? 'write' : ''}>{a.risk.split(':')[0]}</Badge>
              <span className="muted small" style={{ marginLeft: 'auto' }}>{timeAgo(a.createdAt)}</span>
            </div>
            <div className="small dim" style={{ marginTop: 3 }}>Task: <a style={{ cursor: 'pointer' }} onClick={() => openTask(a.taskId)}>{task?.title ?? a.taskId}</a></div>
            <div style={{ marginTop: 4 }}><strong>Action:</strong> {a.summary}</div>
            <div className="small dim">Risk: {a.risk}</div>
            {a.detail && <pre className="mono">{a.detail}</pre>}
            <div className="row" style={{ marginTop: 6 }}>
              <input className="input grow" placeholder="Optional note for the agent" value={notes[a.id] ?? ''} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} />
              {a.toolName === 'run_sql' && a.detail && <button className="btn sm" onClick={() => openSql(a.detail, tasks.find((x) => x.id === a.taskId)?.connectionId, 'Review SQL')}>Review SQL</button>}
              <button className="btn sm success" onClick={() => void act(a.id, true)}><Check size={12} /> Approve</button>
              <button className="btn sm danger" onClick={() => void act(a.id, false)}><XCircle size={12} /> Reject</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AgentEventsTab() {
  const { events, selection, agents } = useStore(useShallow((s) => ({ events: s.events, selection: s.selection, agents: s.agents })));
  const [agentId, setAgentId] = useState<string>('');
  const id = agentId || selection.agentId || '';
  const filtered = useMemo(() => events.filter((e) => (!id || e.agentId === id) && (selection.taskId && !agentId ? e.taskId === selection.taskId || !selection.taskId : true) && e.type !== 'ai.usage'), [events, id, selection.taskId, agentId]);
  return (
    <>
      <div className="filterbar">
        <Bot size={12} />
        <select className="select" value={id} onChange={(e) => setAgentId(e.target.value)}><option value="">All agents</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        {id && <button className="btn ghost sm" onClick={() => openAgent(id)}>Open agent workspace</button>}
        <span className="muted small">{filtered.length} events</span>
      </div>
      <EventList events={filtered} showAgent={!id} />
    </>
  );
}

function HistoryTab() {
  const projectId = useStore((s) => s.projectId);
  const connections = useStore((s) => s.connections);
  const events = useStore((s) => s.events);
  const [rows, setRows] = useState<QueryHistoryEntry[] | null>(null);
  const sqlEvents = events.filter((e) => e.type === 'sql.executed').length;
  React.useEffect(() => { if (projectId) void api.history(projectId).then(setRows); }, [projectId, sqlEvents]);
  if (!rows) return <div className="empty">Loading…</div>;
  if (rows.length === 0) return <div className="empty">No queries executed yet.</div>;
  return (
    <div className="panel-body">
      <table className="data">
        <thead><tr><th>Time</th><th>Status</th><th>SQL</th><th>Rows</th><th>Duration</th><th>Actor</th><th>Connection</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="clickable" onClick={() => openSql(r.sql, r.connectionId, 'History')}>
              <td className="mono">{clock(r.createdAt)}</td>
              <td><Badge status={r.status === 'ok' ? 'ok' : 'error'} /></td>
              <td className="mono" title={r.error ?? r.sql} style={{ maxWidth: 520 }}>{r.sql.replace(/\s+/g, ' ').slice(0, 120)}</td>
              <td className="num">{r.rowCount ?? ''}</td>
              <td className="num">{fmtMs(r.durationMs)}</td>
              <td>{r.actorType}</td>
              <td>{connections.find((c) => c.id === r.connectionId)?.name ?? ''}</td>
              <td><button className="btn ghost sm icon" title="Open in editor"><Play size={11} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BottomPanel() {
  const { bottomTab, approvals } = useStore(useShallow((s) => ({ bottomTab: s.bottomTab, approvals: s.approvals })));
  const st = useStore.getState;
  const tabs: { id: BottomTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'activity', label: 'Activity', icon: <Activity size={12} /> },
    { id: 'results', label: 'SQL Results', icon: <Table size={12} /> },
    { id: 'events', label: 'Agent Events', icon: <Bot size={12} /> },
    { id: 'approvals', label: 'Approvals', icon: <ShieldAlert size={12} />, badge: approvals.length },
    { id: 'history', label: 'History', icon: <History size={12} /> },
  ];
  return (
    <>
      <div className="subtabs">
        {tabs.map((t) => (
          <button key={t.id} className={bottomTab === t.id ? 'active' : ''} onClick={() => st().setBottom(t.id)}>
            {t.icon} {t.label}{t.badge ? <span className="badge yellow">{t.badge}</span> : null}
          </button>
        ))}
        <span className="spacer" />
        <button onClick={() => st().toggle('bottomOpen', false)} title="Close (Ctrl+J)"><X size={12} /></button>
      </div>
      <div className="panel" style={{ flex: 1 }}>
        {bottomTab === 'activity' && <ActivityTab />}
        {bottomTab === 'results' && <ResultsTab />}
        {bottomTab === 'events' && <AgentEventsTab />}
        {bottomTab === 'approvals' && <ApprovalsTab />}
        {bottomTab === 'history' && <HistoryTab />}
      </div>
    </>
  );
}
