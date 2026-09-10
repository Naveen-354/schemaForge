import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Send, X, Bot, Loader2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { Task } from '@schemaforge/shared';
import { api } from '../api';
import { openTask, useStore } from '../store';
import { Badge, Markdown } from './ui';

/**
 * Chat is one interface onto the task system: every question becomes a task assigned to an assistant agent,
 * with the current selection (connection, table, SQL, result) attached as context.
 */
export function Assistant() {
  const { projectId, selection, agents, tasks, connections } = useStore(useShallow((s) => ({ projectId: s.projectId, selection: s.selection, agents: s.agents, tasks: s.tasks, connections: s.connections })));
  const [text, setText] = useState('');
  const [agentId, setAgentId] = useState<string>('');
  const [threadRoot, setThreadRoot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const st = useStore.getState;

  const assistants = agents.filter((a) => !a.projectId || a.projectId === projectId);
  const defaultAgent = assistants.find((a) => /assistant/i.test(a.name) || /assistant/i.test(a.role)) ?? assistants[0];
  const chosen = assistants.find((a) => a.id === agentId) ?? defaultAgent;

  const thread = useMemo(() => {
    const chats = tasks.filter((t) => t.context.kind === 'chat').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!threadRoot) return chats.slice(-8);
    const byId = new Map(chats.map((t) => [t.id, t]));
    const out: Task[] = [];
    let cur = byId.get(threadRoot);
    const visited = new Set<string>();
    // Walk forward: find chain rooted at threadRoot via parentTaskId links.
    while (cur && !visited.has(cur.id)) { out.push(cur); visited.add(cur.id); cur = chats.find((t) => t.context.parentTaskId === cur!.id); }
    return out;
  }, [tasks, threadRoot]);

  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [thread]);

  const conn = connections.find((c) => c.id === selection.connectionId);
  const last = thread.at(-1);

  async function send() {
    const q = text.trim();
    if (!q || !projectId || !chosen) return;
    setBusy(true);
    try {
      const t = await api.ask({
        projectId, question: q, agentId: chosen.id, connectionId: selection.connectionId ?? null,
        context: { table: selection.table, sql: selection.sql, queryResultSummary: selection.resultSummary, parentTaskId: last?.id },
      });
      if (!threadRoot || threadRoot === '__none__') setThreadRoot(last?.id ?? t.id);
      setText('');
      void st().reload('tasks');
    } catch (e) {
      st().toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat">
      <div className="chat-log" ref={logRef}>
        {thread.length === 0 && (
          <div className="empty">
            Ask about the selected database, table or SQL.<br /><span className="small">Examples: "Is this table properly indexed?", "Show customers with active SIPs", "Why is this query slow?", "Generate a migration adding external_id".</span>
          </div>
        )}
        {thread.map((t) => (
          <React.Fragment key={t.id}>
            <div className="chat-msg user">{t.title}</div>
            <div className="chat-msg assistant">
              <div className="who">
                <Bot size={11} /> {agents.find((a) => a.id === t.agentId)?.name ?? 'Agent'}
                <Badge status={t.status} className="small">{t.status === 'WAITING_FOR_APPROVAL' ? 'needs approval' : t.status.toLowerCase()}</Badge>
                <a onClick={() => openTask(t.id)} style={{ marginLeft: 'auto', cursor: 'pointer' }}>task ›</a>
              </div>
              {t.result ? <Markdown text={t.result} /> : t.error ? <span style={{ color: 'var(--red)' }}>{t.error}</span> : (
                <span className="dim row"><Loader2 size={12} className="spin" /> {agents.find((a) => a.id === t.agentId)?.statusMessage ?? 'Working…'}</span>
              )}
              {t.status === 'WAITING_FOR_APPROVAL' && <div style={{ marginTop: 4 }}><button className="btn sm" onClick={() => st().setBottom('approvals', true)}>Review approval</button></div>}
            </div>
          </React.Fragment>
        ))}
      </div>
      <div className="chat-input">
        <div className="context-chips">
          {conn && <span className="chip">db: {conn.name}</span>}
          {selection.table && <span className="chip">table: {selection.table.name}<button onClick={() => st().select({ table: undefined })}><X size={10} /></button></span>}
          {selection.sql && <span className="chip" title={selection.sql}>sql: {selection.sql.slice(0, 24)}…<button onClick={() => st().select({ sql: undefined })}><X size={10} /></button></span>}
          {selection.resultSummary && <span className="chip">result<button onClick={() => st().select({ resultSummary: undefined })}><X size={10} /></button></span>}
          {thread.length > 0 && <span className="chip">thread · {thread.length}<button title="New thread" onClick={() => setThreadRoot('__none__')}><X size={10} /></button></span>}
        </div>
        <textarea className="textarea" placeholder={chosen ? `Ask ${chosen.name}… (Enter to send, Shift+Enter for newline)` : 'Create an agent first'} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <div className="row">
          <select className="select grow" value={chosen?.id ?? ''} onChange={(e) => setAgentId(e.target.value)}>
            {assistants.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.provider}</option>)}
          </select>
          <button className="btn primary" disabled={busy || !text.trim() || !chosen} onClick={() => void send()}><Send size={13} /> Ask</button>
        </div>
      </div>
    </div>
  );
}
