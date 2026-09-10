import React from 'react';
import { Database, Search, PanelLeft, PanelRight, PanelBottom, Bot, Plus, Settings, Activity } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store';

export function TopBar() {
  const { workspaces, workspaceId, projects, projectId, live, approvals, agents } = useStore(useShallow((s) => ({
    workspaces: s.workspaces, workspaceId: s.workspaceId, projects: s.projects, projectId: s.projectId, live: s.live, approvals: s.approvals, agents: s.agents,
  })));
  const st = useStore.getState;
  const running = agents.filter((a) => a.status === 'RUNNING' || a.status === 'WAITING_FOR_APPROVAL').length;
  return (
    <div className="topbar">
      <div className="brand"><Database size={16} /> SchemaForge</div>
      <select className="select" value={workspaceId ?? ''} onChange={(e) => void st().selectWorkspace(e.target.value)} title="Workspace">
        {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      <select className="select" value={projectId ?? ''} onChange={(e) => void st().selectProject(e.target.value || null)} title="Project" style={{ maxWidth: 260 }}>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button className="btn ghost sm" onClick={() => st().setModal({ kind: 'project' })} title="New project"><Plus size={13} /></button>
      <div className="spacer" />
      <button className="btn ghost" onClick={() => st().toggle('paletteOpen', true)} title="Command palette (Ctrl+K)">
        <Search size={14} /> <span className="dim">Search or run a command…</span> <span className="kbd">Ctrl K</span>
      </button>
      <div className="spacer" />
      {approvals.length > 0 && (
        <button className="btn sm" style={{ borderColor: '#5c4a24', color: 'var(--yellow)' }} onClick={() => st().setBottom('approvals', true)}>
          {approvals.length} approval{approvals.length > 1 ? 's' : ''} pending
        </button>
      )}
      <button className="btn ghost sm" onClick={() => st().openTab({ id: 'agents', kind: 'agents', title: 'Agents', params: {} })} title="Agent dashboard">
        <Bot size={14} /> {running > 0 ? <span className="badge RUNNING dot pulse">{running} active</span> : <span className="dim">{agents.length} agents</span>}
      </button>
      <button className="btn ghost sm icon" onClick={() => st().setBottom('activity', true)} title="Activity"><Activity size={14} /></button>
      <span className="badge" title={`Live updates: ${live}`} style={{ color: live === 'open' ? 'var(--green)' : 'var(--yellow)' }}>● {live === 'open' ? 'live' : live}</span>
      <button className="btn ghost sm icon" onClick={() => st().toggle('sidebarOpen')} title="Toggle navigation (Ctrl+B)"><PanelLeft size={14} /></button>
      <button className="btn ghost sm icon" onClick={() => st().toggle('bottomOpen')} title="Toggle bottom panel (Ctrl+J)"><PanelBottom size={14} /></button>
      <button className="btn ghost sm icon" onClick={() => st().toggle('inspectorOpen')} title="Toggle inspector (Ctrl+I)"><PanelRight size={14} /></button>
      <button className="btn ghost sm icon" onClick={() => st().openTab({ id: 'settings', kind: 'settings', title: 'Settings', params: {} })} title="Settings"><Settings size={14} /></button>
    </div>
  );
}
