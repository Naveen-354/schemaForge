import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Package, Search } from 'lucide-react';
import { openAgent, openArtifact, useStore } from '../store';
import { Badge, timeAgo } from '../components/ui';

export function ArtifactsView() {
  const { artifacts, agents, tasks } = useStore(useShallow((s) => ({ artifacts: s.artifacts, agents: s.agents, tasks: s.tasks })));
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const types = useMemo(() => [...new Set(artifacts.map((a) => a.type))].sort(), [artifacts]);
  const list = useMemo(() => artifacts.filter((a) => (!type || a.type === type) && (!q || `${a.title} ${a.content}`.toLowerCase().includes(q.toLowerCase()))), [artifacts, q, type]);
  return (
    <>
      <div className="sql-toolbar">
        <Package size={13} /><strong>Artifacts</strong>
        <span className="row" style={{ gap: 4 }}><Search size={12} /><input className="input sm" placeholder="Search title & content" value={q} onChange={(e) => setQ(e.target.value)} /></span>
        <select className="select" value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{types.map((t) => <option key={t}>{t}</option>)}</select>
        <span className="muted small">{list.length} of {artifacts.length}</span>
      </div>
      <div className="panel-body">
        <table className="data">
          <thead><tr><th>Type</th><th>Title</th><th>Agent</th><th>Task</th><th>Size</th><th>Created</th></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} className="clickable" onClick={() => openArtifact(a.id)}>
                <td><Badge className="purple">{a.type}</Badge></td>
                <td>{a.title}</td>
                <td><a style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); if (a.agentId) openAgent(a.agentId); }}>{agents.find((x) => x.id === a.agentId)?.name ?? ''}</a></td>
                <td className="dim ellipsis" style={{ maxWidth: 320 }}>{tasks.find((t) => t.id === a.taskId)?.title ?? ''}</td>
                <td className="num">{a.content.length.toLocaleString()}</td>
                <td className="dim">{timeAgo(a.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <div className="empty">No artifacts yet. Agents publish SQL, migrations, analyses and reports here; you can hand them to other agents.</div>}
      </div>
    </>
  );
}
