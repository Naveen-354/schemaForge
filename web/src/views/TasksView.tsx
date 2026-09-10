import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ListTodo, Plus, Play, Square, RotateCcw } from 'lucide-react';
import type { TaskStatus } from '@schemaforge/shared';
import { api } from '../api';
import { openAgent, openTask, useStore } from '../store';
import { Badge, StatusDot, timeAgo } from '../components/ui';

const GROUPS: { label: string; statuses: TaskStatus[] }[] = [
  { label: 'In progress', statuses: ['RUNNING', 'WAITING_FOR_APPROVAL', 'PAUSED'] },
  { label: 'Queued / blocked', statuses: ['QUEUED', 'BLOCKED', 'TODO'] },
  { label: 'Done', statuses: ['COMPLETED'] },
  { label: 'Failed / cancelled', statuses: ['FAILED', 'CANCELLED'] },
];

export function TasksView() {
  const { tasks, agents } = useStore(useShallow((s) => ({ tasks: s.tasks, agents: s.agents })));
  const st = useStore.getState;
  const [q, setQ] = useState('');
  const [agentId, setAgentId] = useState('');
  const [showChat, setShowChat] = useState(false);
  const filtered = useMemo(() => tasks.filter((t) => (showChat || t.context.kind !== 'chat') && (!agentId || t.agentId === agentId) && (!q || t.title.toLowerCase().includes(q.toLowerCase()))), [tasks, q, agentId, showChat]);
  return (
    <>
      <div className="sql-toolbar">
        <ListTodo size={13} /><strong>Tasks</strong>
        <input className="input sm" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" value={agentId} onChange={(e) => setAgentId(e.target.value)}><option value="">All agents</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <label className="row small"><input type="checkbox" checked={showChat} onChange={(e) => setShowChat(e.target.checked)} /> include chat questions</label>
        <span className="grow" />
        <button className="btn primary sm" onClick={() => st().setModal({ kind: 'task' })}><Plus size={12} /> New task</button>
      </div>
      <div className="panel-body">
        {GROUPS.map((g) => {
          const rows = filtered.filter((t) => g.statuses.includes(t.status));
          if (rows.length === 0) return null;
          return (
            <div key={g.label}>
              <div className="panel-header">{g.label} <span className="muted">{rows.length}</span></div>
              {rows.map((t) => (
                <div key={t.id} className="list-row" onClick={() => openTask(t.id)}>
                  <StatusDot status={t.status} />
                  <span className="grow" title={t.title}>{t.title}{t.dependsOn.length > 0 && <span className="muted small"> · after {t.dependsOn.length} task{t.dependsOn.length > 1 ? 's' : ''}</span>}</span>
                  <a className="small" style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); if (t.agentId) openAgent(t.agentId); }}>{agents.find((a) => a.id === t.agentId)?.name ?? <span className="muted">unassigned</span>}</a>
                  <Badge>{t.priority}</Badge>
                  <Badge status={t.status}>{t.status === 'WAITING_FOR_APPROVAL' ? 'APPROVAL' : t.status}</Badge>
                  <span className="muted small" style={{ width: 60, textAlign: 'right' }}>{timeAgo(t.updatedAt)}</span>
                  {t.status === 'TODO' && t.agentId && <button className="btn ghost sm icon" title="Start" onClick={(e) => { e.stopPropagation(); void api.taskAction(t.id, 'start'); }}><Play size={11} /></button>}
                  {['RUNNING', 'WAITING_FOR_APPROVAL', 'PAUSED', 'QUEUED'].includes(t.status) && <button className="btn ghost sm icon" title="Stop" onClick={(e) => { e.stopPropagation(); void api.taskAction(t.id, t.status === 'QUEUED' ? 'cancel' : 'stop'); }}><Square size={11} /></button>}
                  {['FAILED', 'CANCELLED', 'BLOCKED'].includes(t.status) && <button className="btn ghost sm icon" title="Retry" onClick={(e) => { e.stopPropagation(); void api.taskAction(t.id, 'retry'); }}><RotateCcw size={11} /></button>}
                </div>
              ))}
            </div>
          );
        })}
        {filtered.length === 0 && <div className="empty">No tasks match.</div>}
      </div>
    </>
  );
}
