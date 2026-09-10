import React, { useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useShallow } from 'zustand/react/shallow';
import { Bot, Info, Wrench, Package } from 'lucide-react';
import { openArtifact, openTask, useStore } from '../store';
import { Assistant } from './Assistant';
import { Badge, KV, StatusDot, timeAgo } from './ui';

function ContextPanel() {
  const { selection, connections, schemas, agents, tasks, artifacts } = useStore(useShallow((s) => ({ selection: s.selection, connections: s.connections, schemas: s.schemas, agents: s.agents, tasks: s.tasks, artifacts: s.artifacts })));
  const conn = connections.find((c) => c.id === selection.connectionId);
  const snap = conn ? schemas[conn.id] : undefined;
  const table = selection.table && snap ? snap.tables.find((t) => t.name === selection.table!.name && t.schema === selection.table!.schema) : undefined;
  const agent = agents.find((a) => a.id === selection.agentId);
  const task = tasks.find((t) => t.id === selection.taskId);
  const relatedArtifacts = task ? artifacts.filter((a) => a.taskId === task.id) : agent ? artifacts.filter((a) => a.agentId === agent.id).slice(0, 5) : [];
  return (
    <div className="panel-body pad col">
      {conn && (
        <div className="section">
          <h4>Database</h4>
          <KV rows={[['Name', conn.name], ['Engine', conn.engine], ['Database', conn.database], ['Status', <Badge status={conn.status === 'connected' ? 'ok' : conn.status === 'error' ? 'error' : ''}>{conn.status}</Badge>], ['Tables', snap ? snap.tables.length : '—']]} />
        </div>
      )}
      {table && (
        <div className="section">
          <h4>Table {table.name}</h4>
          <KV rows={[['Kind', table.kind], ['Columns', table.columns.length], ['Primary key', table.primaryKey.join(', ') || '—'], ['Foreign keys', table.foreignKeys.length], ['Indexes', table.indexes.length], ['Rows', table.rowEstimate?.toLocaleString() ?? '—']]} />
        </div>
      )}
      {selection.sql && (
        <div className="section">
          <h4>Selected SQL</h4>
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 11, background: 'var(--bg)', padding: 6, borderRadius: 4, maxHeight: 140, overflow: 'auto' }}>{selection.sql}</pre>
        </div>
      )}
      {agent && (
        <div className="section">
          <h4>Agent</h4>
          <KV rows={[['Name', agent.name], ['Role', agent.role], ['Status', <span className="row"><StatusDot status={agent.status} /> {agent.status}</span>], ['Now', agent.statusMessage ?? '—'], ['Provider', `${agent.provider} / ${agent.model}`], ['SQL policy', <span className="small">safe {agent.permissions.sql.safe} · write {agent.permissions.sql.write} · ddl {agent.permissions.sql.ddl} · destructive {agent.permissions.sql.destructive}</span>]]} />
        </div>
      )}
      {task && (
        <div className="section">
          <h4>Task</h4>
          <KV rows={[['Title', <a style={{ cursor: 'pointer' }} onClick={() => openTask(task.id)}>{task.title}</a>], ['Status', <Badge status={task.status} />], ['Agent', agents.find((a) => a.id === task.agentId)?.name ?? '—'], ['Priority', task.priority], ['Created', timeAgo(task.createdAt)]]} />
        </div>
      )}
      {relatedArtifacts.length > 0 && (
        <div className="section">
          <h4>Artifacts</h4>
          {relatedArtifacts.map((a) => <div key={a.id} className="row small" style={{ cursor: 'pointer', padding: '2px 0' }} onClick={() => openArtifact(a.id)}><Package size={11} /> <span className="ellipsis grow">{a.title}</span><span className="muted">{a.type}</span></div>)}
        </div>
      )}
      {!conn && !agent && !task && <div className="empty">Select a database, table, agent or task to see its context here.</div>}
    </div>
  );
}

export function Inspector() {
  const [tab, setTab] = useState<'assistant' | 'context'>('assistant');
  return (
    <>
      <div className="subtabs">
        <button className={tab === 'assistant' ? 'active' : ''} onClick={() => setTab('assistant')}><Bot size={12} /> Assistant</button>
        <button className={tab === 'context' ? 'active' : ''} onClick={() => setTab('context')}><Info size={12} /> Context</button>
      </div>
      {tab === 'assistant' ? (
        <PanelGroup direction="vertical">
          <Panel minSize={20} defaultSize={70}><div className="panel"><Assistant /></div></Panel>
          <PanelResizeHandle className="resize-handle" />
          <Panel minSize={10} defaultSize={30}><div className="panel"><div className="panel-header"><Wrench size={11} /> Context details</div><ContextPanel /></div></Panel>
        </PanelGroup>
      ) : <ContextPanel />}
    </>
  );
}
