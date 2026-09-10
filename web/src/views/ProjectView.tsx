import React, { useEffect, useState } from 'react';
import { Save, Trash2, Boxes, Database, Plus } from 'lucide-react';
import { api } from '../api';
import { useProject, useStore } from '../store';
import { Badge, KV, timeAgo } from '../components/ui';

export function ProjectView() {
  const project = useProject();
  const connections = useStore((s) => s.connections);
  const st = useStore.getState;
  const [f, setF] = useState({ name: '', description: '', rootPath: '', instructions: '' });
  const [policy, setPolicy] = useState<{ sql?: Record<string, string> }>({});
  useEffect(() => { if (project) { setF({ name: project.name, description: project.description, rootPath: project.rootPath ?? '', instructions: project.instructions }); void fetch(`/api/projects/${project.id}/policy`).then((r) => r.json()).then(setPolicy); } }, [project?.id, project?.updatedAt]);
  if (!project) return <div className="empty">No project selected.</div>;
  const save = async () => {
    await api.updateProject(project.id, { name: f.name, description: f.description, rootPath: f.rootPath || null, instructions: f.instructions });
    await fetch(`/api/projects/${project.id}/policy`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(policy) });
    st().toast('Project saved', 'success');
    void st().reload('projects');
  };
  const remove = async () => {
    if (!window.confirm(`Delete project "${project.name}" and its connections, tasks and artifacts?`)) return;
    await api.deleteProject(project.id);
    await st().reload('projects');
    await st().selectProject(st().projects[0]?.id ?? null);
    st().closeTab('project');
  };
  const setSql = (k: string, v: string) => setPolicy({ ...policy, sql: { ...(policy.sql ?? {}), ...(v ? { [k]: v } : {}) } });
  return (
    <div className="panel-body pad" style={{ maxWidth: 820 }}>
      <div className="row" style={{ marginBottom: 12 }}><Boxes size={16} /><h2>{project.name}</h2><span className="grow" /><span className="muted small">created {timeAgo(project.createdAt)}</span></div>
      <div className="grid cols-2">
        <div className="field"><label>Name</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field"><label>Source root path (enables file & git tools for agents)</label><input className="input" value={f.rootPath} onChange={(e) => setF({ ...f, rootPath: e.target.value })} placeholder="D:\\code\\my-app" /></div>
      </div>
      <div className="field" style={{ marginTop: 8 }}><label>Description</label><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      <div className="field" style={{ marginTop: 8 }}><label>Instructions for agents (conventions, constraints, architecture notes; sent with every task in this project)</label><textarea className="textarea" style={{ fontFamily: 'var(--sans)', minHeight: 110 }} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></div>
      <div className="section" style={{ marginTop: 14 }}>
        <h4>Project-level SQL policy (restricts every agent in this project; most restrictive layer wins)</h4>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
          {['safe', 'write', 'ddl', 'destructive'].map((k) => (
            <label key={k} className="field"><span className="small dim">{k}</span><select className="select" value={policy.sql?.[k] ?? ''} onChange={(e) => setSql(k, e.target.value)}><option value="">inherit</option><option>allow</option><option>ask</option><option>deny</option></select></label>
          ))}
        </div>
      </div>
      <div className="section">
        <h4><Database size={11} /> Databases</h4>
        {connections.map((c) => <div key={c.id} className="row small" style={{ padding: '2px 0', cursor: 'pointer' }} onClick={() => st().openTab({ kind: 'connection', title: c.name, params: { connectionId: c.id } })}><Badge status={c.status === 'connected' ? 'ok' : c.status === 'error' ? 'error' : ''}>{c.status}</Badge>{c.name}<span className="muted">{c.engine}</span></div>)}
        <button className="btn sm" style={{ marginTop: 6 }} onClick={() => st().setModal({ kind: 'connection' })}><Plus size={12} /> Add connection</button>
      </div>
      <div className="section"><KV rows={[['Project id', <code>{project.id}</code>], ['Workspace', project.workspaceId]]} /></div>
      <div className="row"><button className="btn primary" onClick={() => void save()}><Save size={13} /> Save</button><button className="btn danger" onClick={() => void remove()}><Trash2 size={13} /> Delete project</button></div>
    </div>
  );
}
