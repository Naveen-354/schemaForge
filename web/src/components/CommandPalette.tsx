import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Database, Table2, Columns3, Bot, ListTodo, Package, FileCode, BookOpen, Activity, Boxes, Plus, Settings, Terminal, LayoutDashboard, Search } from 'lucide-react';
import type { SearchHit } from '@schemaforge/shared';
import { api } from '../api';
import { openAgent, openArtifact, openDiagram, openSql, openTable, openTask, useStore } from '../store';

interface Command { id: string; group: string; title: string; subtitle?: string; icon: React.ReactNode; run(): void }

const ICONS: Record<SearchHit['kind'], React.ReactNode> = {
  project: <Boxes size={13} />, connection: <Database size={13} />, table: <Table2 size={13} />, column: <Columns3 size={13} />, agent: <Bot size={13} />,
  task: <ListTodo size={13} />, artifact: <Package size={13} />, query: <FileCode size={13} />, knowledge: <BookOpen size={13} />, event: <Activity size={13} />,
};

export function CommandPalette() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const st = useStore.getState;
  const { connections, agents, projectId, selection, schemas } = st();

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const h = setTimeout(() => { void api.search(q, projectId ?? undefined).then(setHits).catch(() => setHits([])); }, 120);
    return () => clearTimeout(h);
  }, [q, projectId]);

  const commands: Command[] = useMemo(() => {
    const conn = selection.connectionId ?? connections[0]?.id;
    const list: Command[] = [
      { id: 'dash', group: 'Navigate', title: 'Open dashboard', icon: <LayoutDashboard size={13} />, run: () => st().openTab({ id: 'dashboard', kind: 'dashboard', title: 'Dashboard', params: {} }) },
      { id: 'agents', group: 'Navigate', title: 'Open agent dashboard', icon: <Bot size={13} />, run: () => st().openTab({ id: 'agents', kind: 'agents', title: 'Agents', params: {} }) },
      { id: 'tasks', group: 'Navigate', title: 'Open tasks', icon: <ListTodo size={13} />, run: () => st().openTab({ id: 'tasks', kind: 'tasks', title: 'Tasks', params: {} }) },
      { id: 'artifacts', group: 'Navigate', title: 'Search artifacts', icon: <Package size={13} />, run: () => st().openTab({ id: 'artifacts', kind: 'artifacts', title: 'Artifacts', params: {} }) },
      { id: 'knowledge', group: 'Navigate', title: 'Open project knowledge', icon: <BookOpen size={13} />, run: () => st().openTab({ id: 'knowledge', kind: 'knowledge', title: 'Knowledge', params: {} }) },
      { id: 'activity', group: 'Navigate', title: 'View activity', icon: <Activity size={13} />, run: () => st().setBottom('activity', true) },
      { id: 'approvals', group: 'Navigate', title: 'View pending approvals', icon: <Activity size={13} />, run: () => st().setBottom('approvals', true) },
      { id: 'settings', group: 'Navigate', title: 'Settings & AI providers', icon: <Settings size={13} />, run: () => st().openTab({ id: 'settings', kind: 'settings', title: 'Settings', params: {} }) },
      { id: 'project', group: 'Navigate', title: 'Project settings', icon: <Boxes size={13} />, run: () => st().openTab({ id: 'project', kind: 'project', title: 'Project', params: {} }) },
      { id: 'sql', group: 'Actions', title: 'New SQL query', subtitle: 'Ctrl+Shift+N', icon: <Terminal size={13} />, run: () => st().newSqlTab() },
      { id: 'newtask', group: 'Actions', title: 'New task', icon: <Plus size={13} />, run: () => st().setModal({ kind: 'task' }) },
      { id: 'newagent', group: 'Actions', title: 'Create agent', icon: <Plus size={13} />, run: () => st().setModal({ kind: 'agent' }) },
      { id: 'newconn', group: 'Actions', title: 'Add database connection', icon: <Plus size={13} />, run: () => st().setModal({ kind: 'connection' }) },
      { id: 'newproject', group: 'Actions', title: 'New project', icon: <Plus size={13} />, run: () => st().setModal({ kind: 'project' }) },
      { id: 'newknowledge', group: 'Actions', title: 'Add project knowledge', icon: <Plus size={13} />, run: () => st().setModal({ kind: 'knowledge' }) },
    ];
    if (conn) {
      list.push({ id: 'diagram', group: 'Actions', title: 'Open schema diagram', icon: <Boxes size={13} />, run: () => openDiagram(conn) });
      list.push({ id: 'refresh', group: 'Actions', title: 'Refresh schema', icon: <Database size={13} />, run: () => void st().loadSchema(conn, true) });
      list.push({ id: 'lint', group: 'Actions', title: 'Run schema quality checks', icon: <Database size={13} />, run: () => st().openTab({ kind: 'connection', title: connections.find((c) => c.id === conn)?.name ?? 'Database', params: { connectionId: conn, tab: 'quality' } }) });
    }
    if (selection.sql) {
      list.push({ id: 'explain', group: 'AI', title: 'Explain selected SQL', icon: <Bot size={13} />, run: () => ask('Explain this query in plain language.') });
      list.push({ id: 'slow', group: 'AI', title: 'Why is this query slow?', icon: <Bot size={13} />, run: () => ask('Why is this query slow? Inspect the plan and suggest optimizations.') });
    }
    if (selection.table) {
      list.push({ id: 'idx', group: 'AI', title: `Is ${selection.table.name} properly indexed?`, icon: <Bot size={13} />, run: () => ask('Is this table properly indexed?') });
      list.push({ id: 'mig', group: 'AI', title: `Generate migration for ${selection.table.name}`, icon: <Bot size={13} />, run: () => ask(`Generate a migration for adding an external UUID column to ${selection.table!.name}. Do not execute it.`) });
      list.push({ id: 'review', group: 'AI', title: `Review ${selection.table.name} design`, icon: <Bot size={13} />, run: () => st().setModal({ kind: 'task', params: { title: `Review the ${selection.table!.name} schema and identify design problems` } }) });
    }
    for (const c of connections) list.push({ id: `conn:${c.id}`, group: 'Databases', title: `Open ${c.name}`, subtitle: c.engine, icon: <Database size={13} />, run: () => st().openTab({ kind: 'connection', title: c.name, params: { connectionId: c.id } }) });
    for (const a of agents) list.push({ id: `agent:${a.id}`, group: 'Agents', title: a.name, subtitle: a.status, icon: <Bot size={13} />, run: () => openAgent(a.id) });
    return list;
    function ask(question: string) {
      if (!projectId) return;
      void api.ask({ projectId, question, connectionId: selection.connectionId ?? null, context: { table: selection.table, sql: selection.sql } }).then((t) => { st().toast('Asked the assistant'); openTask(t.id); void st().reload('tasks'); });
    }
  }, [connections, agents, projectId, selection, schemas]);

  const filteredCommands = useMemo(() => {
    const t = q.trim().toLowerCase().replace(/^>\s*/, '');
    if (!t) return commands.slice(0, 14);
    return commands.filter((c) => c.title.toLowerCase().includes(t) || c.group.toLowerCase().includes(t)).slice(0, 10);
  }, [commands, q]);

  const localHits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t || t.startsWith('>')) return [] as SearchHit[];
    const out: SearchHit[] = [];
    for (const c of connections) {
      const snap = schemas[c.id];
      if (!snap) continue;
      for (const tb of snap.tables) if (tb.name.toLowerCase().includes(t)) out.push({ kind: 'table', id: `${c.id}:${tb.schema}.${tb.name}`, title: `${tb.schema}.${tb.name}`, subtitle: `${tb.kind} · ${c.name}`, projectId: c.projectId, ref: { connectionId: c.id, schema: tb.schema, table: tb.name } });
    }
    return out.slice(0, 8);
  }, [q, connections, schemas]);

  const items = useMemo(() => {
    const merged: { key: string; group: string; title: string; subtitle?: string; icon: React.ReactNode; run(): void }[] = filteredCommands.map((c) => ({ key: c.id, group: c.group, title: c.title, subtitle: c.subtitle, icon: c.icon, run: c.run }));
    const seen = new Set<string>();
    for (const h of [...localHits, ...hits]) {
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      merged.push({ key: h.id, group: h.kind, title: h.title, subtitle: h.subtitle, icon: ICONS[h.kind], run: () => runHit(h) });
    }
    return merged;
  }, [filteredCommands, localHits, hits]);

  function runHit(h: SearchHit) {
    const r = h.ref as Record<string, string>;
    switch (h.kind) {
      case 'table': case 'column': openTable(r.connectionId, r.schema, r.table); break;
      case 'agent': openAgent(h.id); break;
      case 'task': openTask(h.id); break;
      case 'artifact': openArtifact(h.id); break;
      case 'query': openSql(r.sql, r.connectionId, h.title, h.id); break;
      case 'knowledge': st().openTab({ id: 'knowledge', kind: 'knowledge', title: 'Knowledge', params: { focus: h.id } }); break;
      case 'connection': st().openTab({ kind: 'connection', title: h.title, params: { connectionId: h.id } }); break;
      case 'project': void st().selectProject(h.id); break;
      case 'event': st().setBottom('activity', true); break;
    }
  }

  useEffect(() => setIdx(0), [items.length, q]);
  const run = (i: number) => { const it = items[i]; if (!it) return; st().toggle('paletteOpen', false); it.run(); };

  let lastGroup = '';
  return (
    <div className="overlay" onMouseDown={() => st().toggle('paletteOpen', false)}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input ref={inputRef} placeholder="Search tables, columns, agents, tasks, artifacts, SQL… or type > for commands" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); run(idx); }
          }} />
        <div className="list">
          {items.length === 0 && <div className="empty"><Search size={14} /> No matches</div>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? <div className="group" key={`g-${it.group}-${i}`}>{it.group}</div> : null;
            lastGroup = it.group;
            return (
              <React.Fragment key={it.key}>
                {header}
                <div className={`item ${i === idx ? 'active' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => run(i)}>
                  {it.icon}<span>{it.title}</span>{it.subtitle && <span className="sub">{it.subtitle}</span>}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
