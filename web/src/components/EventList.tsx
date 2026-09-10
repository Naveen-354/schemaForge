import React, { useEffect, useRef } from 'react';
import { Wrench, CheckCircle2, XCircle, AlertTriangle, MessageSquare, Play, Flag, Package, ShieldAlert, ShieldCheck, Database, Cpu, Info, BookOpen, Bot } from 'lucide-react';
import type { SfEvent } from '@schemaforge/shared';
import { openAgent, openArtifact, openTask, useStore } from '../store';
import { clock } from './ui';

function iconFor(e: SfEvent): { icon: React.ReactNode; cls: string } {
  switch (e.type) {
    case 'tool.call': return { icon: <Wrench size={12} />, cls: 'info' };
    case 'tool.result': return { icon: e.level === 'info' ? <CheckCircle2 size={12} /> : <XCircle size={12} />, cls: e.level === 'info' ? 'ok' : e.level };
    case 'agent.message': return { icon: <MessageSquare size={12} />, cls: 'purple' };
    case 'agent.status': return { icon: <Bot size={12} />, cls: '' };
    case 'task.started': return { icon: <Play size={12} />, cls: 'ok' };
    case 'task.completed': return { icon: <Flag size={12} />, cls: 'ok' };
    case 'task.failed': return { icon: <XCircle size={12} />, cls: 'error' };
    case 'task.cancelled': return { icon: <XCircle size={12} />, cls: 'warn' };
    case 'approval.requested': return { icon: <ShieldAlert size={12} />, cls: 'warn' };
    case 'approval.resolved': return { icon: <ShieldCheck size={12} />, cls: e.level === 'warn' ? 'warn' : 'ok' };
    case 'artifact.created': return { icon: <Package size={12} />, cls: 'purple' };
    case 'sql.executed': return { icon: <Database size={12} />, cls: e.level === 'error' ? 'error' : '' };
    case 'ai.usage': return { icon: <Cpu size={12} />, cls: '' };
    case 'knowledge.saved': return { icon: <BookOpen size={12} />, cls: 'purple' };
    case 'error': return { icon: <AlertTriangle size={12} />, cls: 'error' };
    default: return { icon: <Info size={12} />, cls: e.level === 'error' ? 'error' : e.level === 'warn' ? 'warn' : '' };
  }
}

function detailFor(e: SfEvent): string | null {
  const d = e.data;
  if (!d) return null;
  if (e.type === 'tool.call') return `input: ${JSON.stringify(d.input, null, 2)}${d.detail ? `\n\n${d.detail}` : ''}${d.decision && d.decision !== 'allow' ? `\n\npermission: ${d.decision} (${d.reason})` : ''}`;
  if (e.type === 'tool.result') return typeof d.output === 'string' ? d.output : null;
  if (e.type === 'agent.message') return typeof d.full === 'string' && d.full.length > 400 ? d.full : null;
  if (e.type === 'sql.executed') return typeof d.sql === 'string' ? d.sql : null;
  if (e.type === 'approval.requested' || e.type === 'approval.resolved') return typeof d.detail === 'string' && d.detail ? d.detail : null;
  if (e.type === 'task.failed' || e.type === 'error') return typeof d.error === 'string' ? d.error : null;
  if (e.type === 'task.completed') return typeof d.result === 'string' ? d.result : null;
  return null;
}

export function EventList({ events, showAgent = true, showTask = true, follow = true, compact = false }: { events: SfEvent[]; showAgent?: boolean; showTask?: boolean; follow?: boolean; compact?: boolean }) {
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || !follow || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [events, follow]);
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  if (events.length === 0) return <div className="empty">No events yet.</div>;
  return (
    <div className="timeline panel-body" ref={ref} onScroll={onScroll}>
      {events.map((e) => {
        const { icon, cls } = iconFor(e);
        const detail = detailFor(e);
        const agent = e.agentId ? agents.find((a) => a.id === e.agentId) : null;
        const task = e.taskId ? tasks.find((t) => t.id === e.taskId) : null;
        return (
          <div className="event" key={e.seq}>
            <div className="time">{clock(e.createdAt)}</div>
            <div className={`icon ${cls}`}>{icon}</div>
            <div>
              <div className="msg">{e.message}</div>
              {!compact && (showAgent || showTask) && (agent || task) && (
                <div className="meta">
                  {showAgent && agent && <span onClick={() => openAgent(agent.id)}>{agent.name}</span>}
                  {showTask && task && <span onClick={() => openTask(task.id)}>{task.title.slice(0, 60)}</span>}
                  {e.type === 'artifact.created' && typeof e.data?.artifactId === 'string' && <span onClick={() => openArtifact(e.data!.artifactId as string)}>open artifact</span>}
                </div>
              )}
              {detail && <details><summary>details</summary><pre>{detail}</pre></details>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
