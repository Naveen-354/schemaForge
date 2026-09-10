import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Bot, Plus, Square, ShieldAlert } from 'lucide-react';
import { api } from '../api';
import { openAgent, openTask, useStore } from '../store';
import { Badge, StatusDot, timeAgo } from '../components/ui';

/** Multi-agent dashboard: every agent, what it is doing, and what it needs. */
export function AgentsView() {
  const { agents, tasks, events, approvals, projectId } = useStore(useShallow((s) => ({ agents: s.agents, tasks: s.tasks, events: s.events, approvals: s.approvals, projectId: s.projectId })));
  const st = useStore.getState;
  const list = agents.filter((a) => !a.projectId || a.projectId === projectId);
  const order: Record<string, number> = { RUNNING: 0, WAITING_FOR_APPROVAL: 0, PAUSED: 1, QUEUED: 2, WAITING: 2, FAILED: 3, COMPLETED: 4, STOPPED: 5, CANCELLED: 5, IDLE: 6 };
  const sorted = [...list].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.name.localeCompare(b.name));
  return (
    <>
      <div className="sql-toolbar">
        <Bot size={13} /><strong>Agents</strong>
        <span className="dim small">{list.filter((a) => a.status === 'RUNNING').length} running · {list.filter((a) => a.status === 'WAITING_FOR_APPROVAL').length} waiting for approval · {list.filter((a) => a.status === 'IDLE').length} idle</span>
        <span className="grow" />
        <button className="btn primary sm" onClick={() => st().setModal({ kind: 'agent' })}><Plus size={12} /> Create agent</button>
      </div>
      <div className="panel-body pad">
        <div className="grid auto">
          {sorted.map((a) => {
            const task = a.currentTaskId ? tasks.find((t) => t.id === a.currentTaskId) : null;
            const runEvents = a.currentRunId ? events.filter((e) => e.runId === a.currentRunId) : [];
            const toolsUsed = runEvents.filter((e) => e.type === 'tool.call').length;
            const files = new Set(runEvents.filter((e) => e.type === 'log' && typeof e.data?.path === 'string').map((e) => e.data!.path)).size;
            const pending = approvals.find((ap) => ap.agentId === a.id);
            const queued = tasks.filter((t) => t.agentId === a.id && t.status === 'QUEUED');
            const waitingOn = queued[0]?.dependsOn.map((id) => tasks.find((t) => t.id === id)).filter((t) => t && t.status !== 'COMPLETED')[0];
            const last = runEvents.filter((e) => e.type === 'tool.call' || e.type === 'agent.message').at(-1);
            return (
              <div key={a.id} className="card clickable" onClick={() => openAgent(a.id)} style={a.status === 'WAITING_FOR_APPROVAL' ? { borderColor: '#5c4a24' } : a.status === 'RUNNING' ? { borderColor: '#2f6b4d' } : undefined}>
                <div className="row"><StatusDot status={a.status} /><strong>{a.name}</strong><span className="dim small">{a.role}</span><span className="grow" /><Badge status={a.status}>{a.status === 'WAITING_FOR_APPROVAL' ? 'NEEDS APPROVAL' : a.status}</Badge></div>
                <div style={{ marginTop: 6, minHeight: 34 }}>
                  {task ? <div className="ellipsis" title={task.title}><a style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); openTask(task.id); }}>{task.title}</a></div> : queued.length ? <div className="dim">Queued: {queued[0].title}{waitingOn ? <span className="muted"> · waiting for "{waitingOn.title}"</span> : ''}</div> : <div className="muted">{a.statusMessage ?? 'Idle'}</div>}
                  {task && <div className="dim small ellipsis">{a.statusMessage}</div>}
                  {last && last.type === 'tool.call' && <div className="muted small ellipsis">last: {last.message}</div>}
                </div>
                <div className="row small dim" style={{ marginTop: 6 }}>
                  <span>{a.provider}/{a.model}</span>
                  {toolsUsed > 0 && <span>· {toolsUsed} tools used</span>}
                  {files > 0 && <span>· {files} files changed</span>}
                  <span className="grow" />
                  {pending && <button className="btn sm" style={{ color: 'var(--yellow)' }} onClick={(e) => { e.stopPropagation(); st().setBottom('approvals', true); }}><ShieldAlert size={11} /> approve</button>}
                  {task && ['RUNNING', 'WAITING_FOR_APPROVAL', 'PAUSED'].includes(a.status) && <button className="btn sm danger" onClick={(e) => { e.stopPropagation(); void api.taskAction(task.id, 'stop'); }}><Square size={11} /></button>}
                  <span className="muted">{timeAgo(a.updatedAt)}</span>
                </div>
              </div>
            );
          })}
          {list.length === 0 && <div className="empty">No agents yet. Create one from a preset (Database, Architect, Research, Testing, Security, Review…).</div>}
        </div>
      </div>
    </>
  );
}
