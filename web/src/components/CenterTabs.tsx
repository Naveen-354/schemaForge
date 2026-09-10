import React from 'react';
import { X, Plus, LayoutDashboard } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, type Tab } from '../store';
import { Dashboard } from '../views/Dashboard';
import { TableView } from '../views/TableView';
import { DiagramView } from '../views/DiagramView';
import { SqlView } from '../views/SqlView';
import { AgentView } from '../views/AgentView';
import { TaskView } from '../views/TaskView';
import { ArtifactView } from '../views/ArtifactView';
import { KnowledgeView } from '../views/KnowledgeView';
import { SettingsView } from '../views/SettingsView';
import { ConnectionView } from '../views/ConnectionView';
import { AgentsView } from '../views/AgentsView';
import { TasksView } from '../views/TasksView';
import { ArtifactsView } from '../views/ArtifactsView';
import { ProjectView } from '../views/ProjectView';

function renderTab(tab: Tab) {
  switch (tab.kind) {
    case 'dashboard': return <Dashboard />;
    case 'table': return <TableView connectionId={tab.params.connectionId} schema={tab.params.schema} name={tab.params.name} />;
    case 'diagram': return <DiagramView connectionId={tab.params.connectionId} focus={tab.params.focus} />;
    case 'sql': return <SqlView tabId={tab.id} />;
    case 'agent': return <AgentView agentId={tab.params.agentId} />;
    case 'task': return <TaskView taskId={tab.params.taskId} />;
    case 'artifact': return <ArtifactView artifactId={tab.params.artifactId} />;
    case 'knowledge': return <KnowledgeView focus={tab.params.focus} />;
    case 'settings': return <SettingsView />;
    case 'connection': return <ConnectionView connectionId={tab.params.connectionId} initialTab={tab.params.tab} />;
    case 'agents': return <AgentsView />;
    case 'tasks': return <TasksView />;
    case 'artifacts': return <ArtifactsView />;
    case 'project': return <ProjectView />;
    case 'tools': return <AgentsView />;
    default: return <div className="empty">Unknown tab</div>;
  }
}

export function CenterTabs() {
  const { tabs, activeTabId } = useStore(useShallow((s) => ({ tabs: s.tabs, activeTabId: s.activeTabId })));
  const st = useStore.getState;
  const active = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  return (
    <>
      <div className="tabbar">
        {tabs.map((t) => (
          <div key={t.id} className={`tab ${t.id === active.id ? 'active' : ''}`} onClick={() => st().setActiveTab(t.id)} onMouseDown={(e) => { if (e.button === 1 && t.kind !== 'dashboard') { e.preventDefault(); st().closeTab(t.id); } }} title={t.title}>
            {t.kind === 'dashboard' && <LayoutDashboard size={12} />}
            <span className="title">{t.title}</span>
            {t.kind !== 'dashboard' && <button className="close" onClick={(e) => { e.stopPropagation(); st().closeTab(t.id); }}><X size={12} /></button>}
          </div>
        ))}
        <div className="tab-actions">
          <button className="btn ghost sm" title="New SQL query (Ctrl+Shift+N)" onClick={() => st().newSqlTab()}><Plus size={13} /> SQL</button>
        </div>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column' }}>
        {active ? <div key={active.id} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{renderTab(active)}</div> : null}
      </div>
    </>
  );
}
