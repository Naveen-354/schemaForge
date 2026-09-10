import React, { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Play, Square, Pause, RotateCcw, Save, Trash2, Package, Wrench, FileText, ListTodo, Activity, Settings2 } from 'lucide-react';
import type { AgentInput, AgentPermissions, AgentRun, ProviderId } from '@schemaforge/shared';
import { api } from '../api';
import { openArtifact, openTask, useStore } from '../store';
import { Badge, KV, StatusDot, timeAgo, fmtMs, Markdown } from '../components/ui';
import { EventList } from '../components/EventList';
import { PermissionEditor } from '../components/Modals';

export function AgentView({ agentId }: { agentId: string }) {
  const { agent, allTasks, allEvents, allArtifacts } = useStore(useShallow((s) => ({ agent: s.agents.find((a) => a.id === agentId), allTasks: s.tasks, allEvents: s.events, allArtifacts: s.artifacts })));
  const tasks = useMemo(() => allTasks.filter((t) => t.agentId === agentId), [allTasks, agentId]);
  const events = useMemo(() => allEvents.filter((e) => e.agentId === agentId), [allEvents, agentId]);
  const artifacts = useMemo(() => allArtifacts.filter((a) => a.agentId === agentId), [allArtifacts, agentId]);
  const [tab, setTab] = useState<'activity' | 'tasks' | 'artifacts' | 'history' | 'config'>('activity');
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const st = useStore.getState;
  useEffect(() => { st().select({ agentId }); }, [agentId]);
  useEffect(() => { if (tab === 'history') void api.agentRuns(agentId).then(setRuns); }, [tab, agentId, agent?.status]);
  if (!agent) return <div className="empty">Agent not found.</div>;
  const current = agent.currentTaskId ? tasks.find((t) => t.id === agent.currentTaskId) ?? null : null;
  const busy = ['RUNNING', 'WAITING_FOR_APPROVAL', 'PAUSED'].includes(agent.status);
  const currentEvents = agent.currentRunId ? events.filter((e) => e.runId === agent.currentRunId) : events.slice(-80);
  const toolCalls = currentEvents.filter((e) => e.type === 'tool.call');
  const filesChanged = new Set(currentEvents.filter((e) => e.type === 'log' && typeof e.data?.path === 'string').map((e) => e.data!.path as string));
  const dbObjects = new Set(toolCalls.map((e) => (e.data?.input as { table?: string })?.table).filter((x): x is string => !!x));

  return (
    <>
      <div className="sql-toolbar">
        <StatusDot status={agent.status} /><strong>{agent.name}</strong><span className="dim">{agent.role}</span>
        <Badge status={agent.status}>{agent.status === 'WAITING_FOR_APPROVAL' ? 'NEEDS APPROVAL' : agent.status}</Badge>
        <span className="dim small ellipsis" style={{ maxWidth: 360 }}>{agent.statusMessage}</span>
        <span className="grow" />
        {current && agent.status === 'RUNNING' && <button className="btn sm" onClick={() => void api.taskAction(current.id, 'pause')}><Pause size={12} /> Pause</button>}
        {current && agent.status === 'PAUSED' && <button className="btn sm" onClick={() => void api.taskAction(current.id, 'resume')}><Play size={12} /> Resume</button>}
        {current && busy && <button className="btn sm danger" onClick={() => void api.taskAction(current.id, 'stop')}><Square size={12} /> Stop</button>}
        {agent.status === 'WAITING_FOR_APPROVAL' && <button className="btn sm" style={{ color: 'var(--yellow)' }} onClick={() => st().setBottom('approvals', true)}>Review approval</button>}
        {!busy && agent.status !== 'IDLE' && <button className="btn ghost sm" onClick={() => void api.resetAgent(agent.id)} title="Reset status to IDLE"><RotateCcw size={12} /></button>}
        <button className="btn sm" onClick={() => st().setModal({ kind: 'task', params: { agentId: agent.id } })}><ListTodo size={12} /> Assign task</button>
      </div>
      <div className="subtabs">
        <button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}><Activity size={11} /> Activity</button>
        <button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}><ListTodo size={11} /> Tasks ({tasks.length})</button>
        <button className={tab === 'artifacts' ? 'active' : ''} onClick={() => setTab('artifacts')}><Package size={11} /> Artifacts ({artifacts.length})</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><FileText size={11} /> Execution history</button>
        <button className={tab === 'config' ? 'active' : ''} onClick={() => setTab('config')}><Settings2 size={11} /> Configuration</button>
      </div>
      {tab === 'activity' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', flex: 1, minHeight: 0 }}>
          <div className="panel"><EventList events={events.filter((e) => e.type !== 'ai.usage')} showAgent={false} /></div>
          <div className="panel side" style={{ borderLeft: '1px solid var(--border)' }}>
            <div className="panel-body pad col">
              <div className="section"><h4>Current task</h4>{current ? <a style={{ cursor: 'pointer' }} onClick={() => openTask(current.id)}>{current.title}</a> : <span className="muted">none</span>}</div>
              <div className="section"><h4><Wrench size={10} /> Tools used {agent.currentRunId ? '(this run)' : '(recent)'}</h4>
                {toolCalls.length === 0 ? <span className="muted">none</span> : Object.entries(toolCalls.reduce<Record<string, number>>((acc, e) => { const n = String(e.data?.tool ?? '?'); acc[n] = (acc[n] ?? 0) + 1; return acc; }, {})).map(([n, c]) => <div key={n} className="small row"><code>{n}</code><span className="muted">×{c}</span></div>)}
              </div>
              <div className="section"><h4>Database objects</h4>{dbObjects.size === 0 ? <span className="muted">none</span> : [...dbObjects].map((t) => <div key={t} className="small mono">{t}</div>)}</div>
              <div className="section"><h4>Files changed</h4>{filesChanged.size === 0 ? <span className="muted">none</span> : [...filesChanged].map((f) => <div key={f} className="small mono">{f}</div>)}</div>
              <div className="section"><h4>Errors</h4>{currentEvents.filter((e) => e.level === 'error').length === 0 ? <span className="muted">none</span> : currentEvents.filter((e) => e.level === 'error').slice(-5).map((e) => <div key={e.seq} className="small" style={{ color: 'var(--red)' }}>{e.message}</div>)}</div>
            </div>
          </div>
        </div>
      )}
      {tab === 'tasks' && (
        <div className="panel-body">
          {tasks.length === 0 && <div className="empty">No tasks assigned yet.</div>}
          {tasks.map((t) => (
            <div key={t.id} className="list-row" onClick={() => openTask(t.id)}>
              <StatusDot status={t.status} /><span className="grow">{t.title}</span><span className="muted small">{timeAgo(t.updatedAt)}</span><Badge status={t.status} />
              {['FAILED', 'CANCELLED', 'TODO', 'BLOCKED'].includes(t.status) && <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); void api.taskAction(t.id, 'retry'); }}><Play size={11} /> Run</button>}
            </div>
          ))}
        </div>
      )}
      {tab === 'artifacts' && (
        <div className="panel-body">
          {artifacts.length === 0 && <div className="empty">No artifacts produced yet.</div>}
          {artifacts.map((a) => <div key={a.id} className="list-row" onClick={() => openArtifact(a.id)}><Badge className="purple">{a.type}</Badge><span className="grow">{a.title}</span><span className="muted small">{timeAgo(a.createdAt)}</span></div>)}
        </div>
      )}
      {tab === 'history' && (
        <div className="panel-body">
          <table className="data">
            <thead><tr><th>Started</th><th>Task</th><th>Status</th><th>Steps</th><th>Model</th><th>Tokens in/out</th><th>Cost</th><th>Latency</th><th>Error</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => openTask(r.taskId)}>
                  <td>{timeAgo(r.startedAt)}</td><td className="ellipsis" style={{ maxWidth: 300 }}>{st().tasks.find((t) => t.id === r.taskId)?.title ?? r.taskId}</td><td><Badge status={r.status} /></td>
                  <td className="num">{r.iterations}</td><td className="mono">{r.model}</td><td className="num">{r.usage.inputTokens}/{r.usage.outputTokens}</td><td className="num">${r.usage.estimatedCostUsd.toFixed(4)}</td><td className="num">{fmtMs(r.usage.latencyMs)}</td><td className="dim" style={{ maxWidth: 260 }}>{r.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {runs.length === 0 && <div className="empty">No runs yet.</div>}
        </div>
      )}
      {tab === 'config' && <AgentConfig agentId={agent.id} />}
    </>
  );
}

function AgentConfig({ agentId }: { agentId: string }) {
  const agent = useStore((s) => s.agents.find((a) => a.id === agentId))!;
  const st = useStore.getState;
  const [f, setF] = useState<AgentInput>({ name: agent.name, role: agent.role, instructions: agent.instructions, provider: agent.provider, model: agent.model, maxIterations: agent.maxIterations, projectId: agent.projectId });
  const [perms, setPerms] = useState<AgentPermissions>(agent.permissions);
  const [providers, setProviders] = useState<{ id: ProviderId; name: string; configured: boolean; models: string[]; defaultModel: string }[]>([]);
  const [tools, setTools] = useState<{ name: string; risk: string }[]>([]);
  useEffect(() => { void api.settings().then((s) => setProviders(s.providers)); void api.agentTools().then(setTools); }, []);
  const save = async () => {
    try { await api.updateAgent(agentId, { ...f, permissions: perms }); st().toast('Agent saved', 'success'); void st().reload('agents'); } catch (e) { st().toast((e as Error).message, 'error'); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete agent "${agent.name}"?`)) return;
    try { await api.deleteAgent(agentId); st().closeTab(`agent:${agentId}`); void st().reload('agents'); } catch (e) { st().toast((e as Error).message, 'error'); }
  };
  const prov = providers.find((p) => p.id === f.provider);
  return (
    <div className="panel-body pad" style={{ maxWidth: 820 }}>
      <div className="grid cols-2">
        <div className="field"><label>Name</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field"><label>Role</label><input className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} /></div>
      </div>
      <div className="field" style={{ marginTop: 8 }}><label>Instructions</label><textarea className="textarea" style={{ fontFamily: 'var(--sans)', minHeight: 100 }} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></div>
      <div className="grid cols-3" style={{ marginTop: 8 }}>
        <div className="field"><label>Provider</label><select className="select" value={f.provider} onChange={(e) => { const p = providers.find((x) => x.id === e.target.value); setF({ ...f, provider: e.target.value as ProviderId, model: p?.defaultModel ?? f.model }); }}>{providers.map((p) => <option key={p.id} value={p.id} disabled={!p.configured}>{p.name}{p.configured ? '' : ' (not configured)'}</option>)}</select></div>
        <div className="field"><label>Model</label><input className="input" list={`models-${agentId}`} value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} /><datalist id={`models-${agentId}`}>{(prov?.models ?? []).map((m) => <option key={m} value={m} />)}</datalist></div>
        <div className="field"><label>Max steps per task</label><input className="input" type="number" value={f.maxIterations} onChange={(e) => setF({ ...f, maxIterations: Number(e.target.value) })} /></div>
      </div>
      <div className="section" style={{ marginTop: 12 }}><h4>Permissions</h4><PermissionEditor value={perms} onChange={setPerms} tools={tools} /></div>
      <div className="section"><h4>Details</h4><KV rows={[['Id', <code>{agent.id}</code>], ['Scope', agent.projectId ? 'project' : 'workspace'], ['Created', timeAgo(agent.createdAt)], ['Capabilities', agent.capabilities.length ? agent.capabilities.join(', ') : 'all tools']]} /></div>
      <div className="row"><button className="btn primary" onClick={() => void save()}><Save size={13} /> Save</button><button className="btn danger" onClick={() => void remove()}><Trash2 size={13} /> Delete agent</button></div>
      {agent.instructions && <div className="section" style={{ marginTop: 14 }}><h4>Instructions preview</h4><Markdown text={agent.instructions} /></div>}
    </div>
  );
}
