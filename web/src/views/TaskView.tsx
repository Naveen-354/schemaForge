import React, { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Play, Square, Pause, RotateCcw, Trash2, Package, UserCog, ShieldAlert, Activity, FileText, MessageSquare } from 'lucide-react';
import type { AgentRun, RunMessage } from '@schemaforge/shared';
import { api } from '../api';
import { openAgent, openArtifact, openTask, useStore } from '../store';
import { Badge, ErrorBox, KV, Markdown, StatusDot, timeAgo, fmtMs } from '../components/ui';
import { EventList } from '../components/EventList';

export function TaskView({ taskId }: { taskId: string }) {
  const { task, agents, allEvents, allArtifacts, allApprovals, tasks, connections } = useStore(useShallow((s) => ({ task: s.tasks.find((t) => t.id === taskId), agents: s.agents, allEvents: s.events, allArtifacts: s.artifacts, allApprovals: s.approvals, tasks: s.tasks, connections: s.connections })));
  const events = useMemo(() => allEvents.filter((e) => e.taskId === taskId), [allEvents, taskId]);
  const artifacts = useMemo(() => allArtifacts.filter((a) => a.taskId === taskId), [allArtifacts, taskId]);
  const approvals = useMemo(() => allApprovals.filter((a) => a.taskId === taskId), [allApprovals, taskId]);
  const [tab, setTab] = useState<'overview' | 'activity' | 'transcript' | 'runs'>('overview');
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [transcript, setTranscript] = useState<RunMessage[]>([]);
  const [reassign, setReassign] = useState('');
  const st = useStore.getState;
  useEffect(() => { st().select({ taskId, agentId: task?.agentId ?? undefined }); }, [taskId, task?.agentId]);
  useEffect(() => { void api.taskRuns(taskId).then(setRuns); }, [taskId, task?.status]);
  useEffect(() => {
    if (tab !== 'transcript') return;
    const runId = task?.currentRunId ?? runs[0]?.id;
    if (runId) void api.run(runId).then((r) => setTranscript(r.messages));
  }, [tab, task?.currentRunId, runs, task?.status]);
  if (!task) return <div className="empty">Task not found (it may have been deleted).</div>;
  const agent = agents.find((a) => a.id === task.agentId);
  const busy = ['RUNNING', 'WAITING_FOR_APPROVAL', 'PAUSED', 'QUEUED'].includes(task.status);
  const act = async (a: 'start' | 'stop' | 'cancel' | 'pause' | 'resume' | 'retry', body?: unknown) => {
    try { await api.taskAction(task.id, a, body); void st().reload('tasks'); } catch (e) { st().toast((e as Error).message, 'error'); }
  };
  const remove = async () => { if (!window.confirm('Delete this task?')) return; await api.deleteTask(task.id); st().closeTab(`task:${task.id}`); void st().reload('tasks'); };
  const conn = connections.find((c) => c.id === task.connectionId);
  const usage = runs.reduce((acc, r) => ({ cost: acc.cost + r.usage.estimatedCostUsd, tokens: acc.tokens + r.usage.inputTokens + r.usage.outputTokens, calls: acc.calls + r.usage.calls }), { cost: 0, tokens: 0, calls: 0 });

  return (
    <>
      <div className="sql-toolbar">
        <StatusDot status={task.status} /><strong className="ellipsis" style={{ maxWidth: 420 }}>{task.title}</strong>
        <Badge status={task.status}>{task.status === 'WAITING_FOR_APPROVAL' ? 'NEEDS APPROVAL' : task.status}</Badge>
        {task.context.kind === 'chat' && <Badge><MessageSquare size={9} /> chat</Badge>}
        <span className="grow" />
        {task.status === 'TODO' && task.agentId && <button className="btn primary sm" onClick={() => void act('start')}><Play size={12} /> Start</button>}
        {task.status === 'RUNNING' && <button className="btn sm" onClick={() => void act('pause')}><Pause size={12} /> Pause</button>}
        {task.status === 'PAUSED' && <button className="btn sm" onClick={() => void act('resume')}><Play size={12} /> Resume</button>}
        {busy && <button className="btn sm danger" onClick={() => void act(task.status === 'QUEUED' ? 'cancel' : 'stop')}><Square size={12} /> {task.status === 'QUEUED' ? 'Cancel' : 'Stop'}</button>}
        {task.status === 'WAITING_FOR_APPROVAL' && <button className="btn sm" style={{ color: 'var(--yellow)' }} onClick={() => st().setBottom('approvals', true)}><ShieldAlert size={12} /> Review approval</button>}
        {['FAILED', 'CANCELLED', 'COMPLETED', 'BLOCKED'].includes(task.status) && <button className="btn sm" onClick={() => void act('retry')}><RotateCcw size={12} /> {task.status === 'COMPLETED' ? 'Run again' : 'Retry'}</button>}
        {!busy && <button className="btn ghost sm icon" onClick={() => void remove()} title="Delete"><Trash2 size={12} /></button>}
      </div>
      <div className="subtabs">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}><FileText size={11} /> Overview</button>
        <button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}><Activity size={11} /> Activity ({events.length})</button>
        <button className={tab === 'transcript' ? 'active' : ''} onClick={() => setTab('transcript')}><MessageSquare size={11} /> Transcript</button>
        <button className={tab === 'runs' ? 'active' : ''} onClick={() => setTab('runs')}>Runs ({runs.length})</button>
      </div>
      {tab === 'overview' && (
        <div className="panel-body pad" style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 14, alignItems: 'start' }}>
          <div className="col">
            {task.description && <div className="card"><Markdown text={task.description} /></div>}
            {task.error && (
              <ErrorBox error={task.error} actions={<>
                <button className="btn sm" onClick={() => void act('retry')}><RotateCcw size={12} /> Retry</button>
                <button className="btn sm" onClick={() => setTab('activity')}>Inspect activity</button>
                {conn && <button className="btn sm" onClick={() => st().openTab({ kind: 'connection', title: conn.name, params: { connectionId: conn.id } })}>Check connection</button>}
                <span className="row small"><UserCog size={12} /><select className="select" value={reassign} onChange={(e) => setReassign(e.target.value)}><option value="">Assign another agent…</option>{agents.filter((a) => a.id !== task.agentId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>{reassign && <button className="btn sm primary" onClick={() => void act('retry', { agentId: reassign })}>Go</button>}</span>
              </>} />
            )}
            {approvals.length > 0 && <div className="card" style={{ borderColor: '#5c4a24' }}><div className="row"><ShieldAlert size={13} style={{ color: 'var(--yellow)' }} /> Waiting for approval: {approvals[0].summary}<span className="grow" /><button className="btn sm" onClick={() => st().setBottom('approvals', true)}>Review</button></div></div>}
            <div className="card">
              <h4 style={{ marginBottom: 6 }}>Result</h4>
              {task.result ? <Markdown text={task.result} /> : <span className="muted">{busy ? (agent?.statusMessage ?? 'Working…') : 'No result yet.'}</span>}
            </div>
            {artifacts.length > 0 && (
              <div className="card" style={{ padding: 0 }}>
                <div className="panel-header"><Package size={11} /> Artifacts</div>
                {artifacts.map((a) => <div key={a.id} className="list-row" onClick={() => openArtifact(a.id)}><Badge className="purple">{a.type}</Badge><span className="grow">{a.title}</span><span className="muted small">{timeAgo(a.createdAt)}</span></div>)}
              </div>
            )}
          </div>
          <div className="col">
            <div className="card">
              <KV rows={[
                ['Agent', agent ? <a style={{ cursor: 'pointer' }} onClick={() => openAgent(agent.id)}>{agent.name}</a> : <span className="muted">unassigned</span>],
                ['Database', conn?.name ?? '—'], ['Priority', task.priority], ['Created', timeAgo(task.createdAt)], ['Started', task.startedAt ? timeAgo(task.startedAt) : '—'], ['Completed', task.completedAt ? timeAgo(task.completedAt) : '—'],
                ['AI usage', runs.length ? `${usage.calls} calls · ${usage.tokens.toLocaleString()} tokens · $${usage.cost.toFixed(4)}` : '—'],
              ]} />
            </div>
            {(task.context.table || task.context.sql || task.context.parentTaskId) && (
              <div className="card">
                <h4 style={{ marginBottom: 6 }}>Context</h4>
                {task.context.table && <div className="small">Table: <code>{task.context.table.schema}.{task.context.table.name}</code></div>}
                {task.context.sql && <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: '4px 0', maxHeight: 160, overflow: 'auto' }}>{task.context.sql}</pre>}
                {task.context.parentTaskId && <div className="small">Follow-up of: <a style={{ cursor: 'pointer' }} onClick={() => openTask(task.context.parentTaskId!)}>{tasks.find((t) => t.id === task.context.parentTaskId)?.title ?? 'previous task'}</a></div>}
              </div>
            )}
            {task.dependsOn.length > 0 && (
              <div className="card"><h4 style={{ marginBottom: 6 }}>Depends on</h4>{task.dependsOn.map((id) => { const d = tasks.find((t) => t.id === id); return <div key={id} className="row small" style={{ cursor: 'pointer' }} onClick={() => openTask(id)}><StatusDot status={d?.status ?? 'TODO'} />{d?.title ?? id}</div>; })}</div>
            )}
            {tasks.some((t) => t.dependsOn.includes(task.id)) && (
              <div className="card"><h4 style={{ marginBottom: 6 }}>Feeds into</h4>{tasks.filter((t) => t.dependsOn.includes(task.id)).map((t) => <div key={t.id} className="row small" style={{ cursor: 'pointer' }} onClick={() => openTask(t.id)}><StatusDot status={t.status} />{t.title}</div>)}</div>
            )}
          </div>
        </div>
      )}
      {tab === 'activity' && <EventList events={events} showTask={false} />}
      {tab === 'transcript' && (
        <div className="panel-body pad col">
          {transcript.length === 0 && <div className="empty">No transcript yet.</div>}
          {transcript.map((m) => (
            <div key={m.id} className="card" style={{ padding: '6px 10px' }}>
              <div className="small dim" style={{ marginBottom: 3 }}>{m.role}{m.toolName ? ` · ${m.toolName}` : ''} · #{m.seq}</div>
              {m.role === 'tool' ? <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: 260, overflow: 'auto' }}>{m.content.length > 4000 ? m.content.slice(0, 4000) + '…' : m.content}</pre> : <Markdown text={m.content} />}
            </div>
          ))}
        </div>
      )}
      {tab === 'runs' && (
        <div className="panel-body">
          <table className="data">
            <thead><tr><th>Started</th><th>Agent</th><th>Status</th><th>Steps</th><th>Model</th><th>Tokens</th><th>Cost</th><th>Latency</th><th>Error</th></tr></thead>
            <tbody>{runs.map((r) => <tr key={r.id}><td>{timeAgo(r.startedAt)}</td><td>{agents.find((a) => a.id === r.agentId)?.name}</td><td><Badge status={r.status} /></td><td className="num">{r.iterations}</td><td className="mono">{r.model}</td><td className="num">{r.usage.inputTokens + r.usage.outputTokens}</td><td className="num">${r.usage.estimatedCostUsd.toFixed(4)}</td><td className="num">{fmtMs(r.usage.latencyMs)}</td><td className="dim">{r.error ?? ''}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
