import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Bot, Plus, ShieldAlert, Package, ListTodo, Database, Cpu } from 'lucide-react';
import { openAgent, openArtifact, openTask, useProject, useStore } from '../store';
import { Badge, StatusDot, timeAgo } from '../components/ui';
import { EventList } from '../components/EventList';

export function Dashboard() {
  const { agents, tasks, approvals, artifacts, events, connections, projectId } = useStore(useShallow((s) => ({ agents: s.agents, tasks: s.tasks, approvals: s.approvals, artifacts: s.artifacts, events: s.events, connections: s.connections, projectId: s.projectId })));
  const project = useProject();
  const st = useStore.getState;
  const visibleAgents = agents.filter((a) => !a.projectId || a.projectId === projectId);
  const active = tasks.filter((t) => ['QUEUED', 'RUNNING', 'WAITING_FOR_APPROVAL', 'PAUSED', 'BLOCKED'].includes(t.status));
  const recentDone = tasks.filter((t) => ['COMPLETED', 'FAILED'].includes(t.status)).slice(0, 8);
  const usage = events.filter((e) => e.type === 'ai.usage').reduce((acc, e) => ({ calls: acc.calls + 1, cost: acc.cost + Number(e.data?.costUsd ?? 0), tokens: acc.tokens + Number(e.data?.inputTokens ?? 0) + Number(e.data?.outputTokens ?? 0) }), { calls: 0, cost: 0, tokens: 0 });
  const projectEvents = events.filter((e) => !e.projectId || e.projectId === projectId).slice(-40);

  return (
    <div className="panel-body pad">
      <div className="row" style={{ marginBottom: 12 }}>
        <div>
          <h2>{project?.name ?? 'Workspace'}</h2>
          <div className="dim small">{project?.description}</div>
        </div>
        <span className="grow" />
        <button className="btn" onClick={() => st().setModal({ kind: 'task' })}><Plus size={13} /> New task</button>
        <button className="btn" onClick={() => st().setModal({ kind: 'agent' })}><Bot size={13} /> New agent</button>
        <button className="btn" onClick={() => st().setModal({ kind: 'connection' })}><Database size={13} /> Add database</button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', marginBottom: 14 }}>
        <div className="stat"><span className="n">{visibleAgents.filter((a) => a.status === 'RUNNING' || a.status === 'WAITING_FOR_APPROVAL').length}<span className="dim small"> / {visibleAgents.length}</span></span><span className="l">agents active</span></div>
        <div className="stat"><span className="n">{active.length}</span><span className="l">tasks in flight</span></div>
        <div className="stat" style={approvals.length ? { borderColor: '#5c4a24' } : undefined}><span className="n" style={approvals.length ? { color: 'var(--yellow)' } : undefined}>{approvals.length}</span><span className="l">pending approvals</span></div>
        <div className="stat"><span className="n">{artifacts.length}</span><span className="l">artifacts</span></div>
        <div className="stat" title={`${usage.tokens.toLocaleString()} tokens across ${usage.calls} calls (session)`}><span className="n">${usage.cost.toFixed(3)}</span><span className="l">est. AI cost (recent)</span></div>
      </div>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card" style={{ padding: 0 }}>
          <div className="panel-header"><Bot size={11} /> Agents <span className="spacer" /><a style={{ cursor: 'pointer' }} onClick={() => st().openTab({ id: 'agents', kind: 'agents', title: 'Agents', params: {} })}>dashboard ›</a></div>
          {visibleAgents.length === 0 && <div className="empty">No agents yet.</div>}
          {visibleAgents.map((a) => {
            const task = a.currentTaskId ? tasks.find((t) => t.id === a.currentTaskId) : null;
            const toolsUsed = a.currentRunId ? events.filter((e) => e.runId === a.currentRunId && e.type === 'tool.call').length : 0;
            return (
              <div key={a.id} className="agent-card" onClick={() => openAgent(a.id)}>
                <StatusDot status={a.status} />
                <div className="name">{a.name} <span className="dim small" style={{ fontWeight: 400 }}>· {a.role}</span></div>
                <Badge status={a.status}>{a.status === 'WAITING_FOR_APPROVAL' ? 'NEEDS APPROVAL' : a.status}</Badge>
                <div className="sub">{a.statusMessage ?? (task ? task.title : 'Idle')}{toolsUsed ? ` · ${toolsUsed} tool calls` : ''}</div>
              </div>
            );
          })}
        </div>

        <div className="col">
          {approvals.length > 0 && (
            <div className="card" style={{ borderColor: '#5c4a24' }}>
              <div className="row" style={{ marginBottom: 6 }}><ShieldAlert size={13} style={{ color: 'var(--yellow)' }} /> <strong>Waiting for your approval</strong><span className="grow" /><button className="btn sm" onClick={() => st().setBottom('approvals', true)}>Review</button></div>
              {approvals.slice(0, 4).map((a) => <div key={a.id} className="small" style={{ padding: '2px 0' }}>{agents.find((x) => x.id === a.agentId)?.name}: {a.summary}</div>)}
            </div>
          )}
          <div className="card" style={{ padding: 0 }}>
            <div className="panel-header"><ListTodo size={11} /> Tasks <span className="spacer" /><a style={{ cursor: 'pointer' }} onClick={() => st().openTab({ id: 'tasks', kind: 'tasks', title: 'Tasks', params: {} })}>all ›</a></div>
            {active.length === 0 && recentDone.length === 0 && <div className="empty">No tasks yet. Create one and assign an agent.</div>}
            {[...active, ...recentDone].map((t) => (
              <div key={t.id} className="list-row" onClick={() => openTask(t.id)}>
                <StatusDot status={t.status} /><span className="grow" title={t.title}>{t.title}</span>
                <span className="muted small">{agents.find((a) => a.id === t.agentId)?.name ?? 'unassigned'}</span>
                <Badge status={t.status}>{t.status === 'WAITING_FOR_APPROVAL' ? 'APPROVAL' : t.status}</Badge>
              </div>
            ))}
          </div>
          <div className="card" style={{ padding: 0 }}>
            <div className="panel-header"><Package size={11} /> Recent artifacts</div>
            {artifacts.length === 0 && <div className="empty">Agents will publish SQL, migrations and analyses here.</div>}
            {artifacts.slice(0, 6).map((a) => (
              <div key={a.id} className="list-row" onClick={() => openArtifact(a.id)}>
                <Badge className="purple">{a.type}</Badge><span className="grow">{a.title}</span><span className="muted small">{timeAgo(a.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, marginTop: 12 }}>
        <div className="panel-header"><Cpu size={11} /> Recent activity <span className="spacer" /><span className="muted">{connections.length} database{connections.length === 1 ? '' : 's'}</span></div>
        <div style={{ maxHeight: 320, overflow: 'auto' }}><EventList events={projectEvents} follow={false} /></div>
      </div>
    </div>
  );
}
