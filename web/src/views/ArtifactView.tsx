import React, { useEffect, useState } from 'react';
import { Copy, Play, Trash2, Bot, Package } from 'lucide-react';
import type { Artifact } from '@schemaforge/shared';
import { api } from '../api';
import { openAgent, openSql, openTask, useStore } from '../store';
import { Badge, KV, Markdown, timeAgo } from '../components/ui';

export function ArtifactView({ artifactId }: { artifactId: string }) {
  const cached = useStore((s) => s.artifacts.find((a) => a.id === artifactId));
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);
  const [artifact, setArtifact] = useState<Artifact | null>(cached ?? null);
  const [raw, setRaw] = useState(false);
  const st = useStore.getState;
  useEffect(() => { void api.artifact(artifactId).then(setArtifact).catch(() => undefined); }, [artifactId]);
  useEffect(() => { st().select({ artifactId }); }, [artifactId]);
  if (!artifact) return <div className="empty">Loading…</div>;
  const isSql = artifact.language === 'sql' || artifact.type === 'sql' || artifact.type === 'migration';
  const task = tasks.find((t) => t.id === artifact.taskId);
  const connectionId = task?.connectionId ?? undefined;
  const remove = async () => { if (!window.confirm('Delete artifact?')) return; await api.deleteArtifact(artifact.id); st().closeTab(`artifact:${artifact.id}`); void st().reload('artifacts'); };
  return (
    <>
      <div className="sql-toolbar">
        <Package size={13} /><strong>{artifact.title}</strong><Badge className="purple">{artifact.type}</Badge>{artifact.language && <span className="dim small">{artifact.language}</span>}
        <span className="grow" />
        <button className="btn sm" onClick={() => { void navigator.clipboard.writeText(artifact.content); st().toast('Copied', 'success'); }}><Copy size={12} /> Copy</button>
        {isSql && <button className="btn sm primary" onClick={() => openSql(artifact.content, connectionId, artifact.title)}><Play size={12} /> Open in SQL editor</button>}
        <button className="btn sm" onClick={() => st().setModal({ kind: 'task', params: { title: `Review artifact "${artifact.title}" and validate it` } })}><Bot size={12} /> Hand to agent</button>
        <button className="btn ghost sm" onClick={() => setRaw(!raw)}>{raw ? 'rendered' : 'raw'}</button>
        <button className="btn ghost sm icon" onClick={() => void remove()}><Trash2 size={12} /></button>
      </div>
      <div className="panel-body pad" style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 14, alignItems: 'start' }}>
        <div className="card">
          {raw || isSql || artifact.language === 'json' || artifact.type === 'code'
            ? <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{artifact.content}</pre>
            : <Markdown text={artifact.content} />}
        </div>
        <div className="card">
          <KV rows={[
            ['Created', timeAgo(artifact.createdAt)],
            ['Agent', artifact.agentId ? <a style={{ cursor: 'pointer' }} onClick={() => openAgent(artifact.agentId!)}>{agents.find((a) => a.id === artifact.agentId)?.name ?? 'agent'}</a> : '—'],
            ['Task', task ? <a style={{ cursor: 'pointer' }} onClick={() => openTask(task.id)}>{task.title}</a> : '—'],
            ['Size', `${artifact.content.length.toLocaleString()} chars`],
            ['Id', <code className="small">{artifact.id}</code>],
          ]} />
        </div>
      </div>
    </>
  );
}
