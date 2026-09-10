import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Save, BookOpen, Search } from 'lucide-react';
import type { KnowledgeEntry } from '@schemaforge/shared';
import { api } from '../api';
import { useStore } from '../store';
import { Badge, Markdown, timeAgo } from '../components/ui';

export function KnowledgeView({ focus }: { focus?: string }) {
  const knowledge = useStore((s) => s.knowledge);
  const agents = useStore((s) => s.agents);
  const st = useStore.getState;
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(focus ?? null);
  const [draft, setDraft] = useState<Partial<KnowledgeEntry> | null>(null);
  useEffect(() => { if (focus) setSelectedId(focus); }, [focus]);
  const categories = useMemo(() => [...new Set(knowledge.map((k) => k.category))].sort(), [knowledge]);
  const list = useMemo(() => knowledge.filter((k) => (!category || k.category === category) && (!q || `${k.title} ${k.content} ${k.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase()))), [knowledge, q, category]);
  const selected = knowledge.find((k) => k.id === selectedId) ?? null;
  useEffect(() => { setDraft(selected ? { ...selected } : null); }, [selectedId, selected?.updatedAt]);
  const save = async () => {
    if (!draft || !selected) return;
    await api.updateKnowledge(selected.id, { title: draft.title, content: draft.content, category: draft.category, tags: draft.tags });
    st().toast('Saved', 'success');
    void st().reload('knowledge');
  };
  const remove = async () => {
    if (!selected || !window.confirm('Delete this entry?')) return;
    await api.deleteKnowledge(selected.id);
    setSelectedId(null);
    void st().reload('knowledge');
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', flex: 1, minHeight: 0 }}>
      <div className="panel side" style={{ borderRight: '1px solid var(--border)' }}>
        <div className="filterbar">
          <Search size={12} /><input className="input grow" placeholder="Search knowledge" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">all</option>{categories.map((c) => <option key={c}>{c}</option>)}</select>
          <button className="btn ghost sm icon" onClick={() => st().setModal({ kind: 'knowledge' })} title="Add"><Plus size={12} /></button>
        </div>
        <div className="panel-body">
          {list.length === 0 && <div className="empty">No knowledge entries. Agents and you can add conventions, decisions and rules here.</div>}
          {list.map((k) => (
            <div key={k.id} className={`list-row ${k.id === selectedId ? 'selected' : ''}`} style={k.id === selectedId ? { background: 'var(--bg-4)' } : undefined} onClick={() => setSelectedId(k.id)}>
              <BookOpen size={11} /><span className="grow">{k.title}</span><Badge>{k.category}</Badge>{k.scope === 'agent' && <Badge className="cyan">agent</Badge>}
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        {!selected || !draft ? <div className="empty">Select an entry to view or edit it. Agents retrieve relevant entries automatically when they work on tasks.</div> : (
          <div className="panel-body pad" style={{ maxWidth: 860 }}>
            <div className="grid cols-2">
              <div className="field"><label>Title</label><input className="input" value={draft.title ?? ''} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></div>
              <div className="field"><label>Category</label><input className="input" value={draft.category ?? ''} onChange={(e) => setDraft({ ...draft, category: e.target.value })} list="kn-cats" /><datalist id="kn-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></div>
            </div>
            <div className="field" style={{ marginTop: 8 }}><label>Tags (comma separated)</label><input className="input" value={(draft.tags ?? []).join(', ')} onChange={(e) => setDraft({ ...draft, tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></div>
            <div className="field" style={{ marginTop: 8 }}><label>Content</label><textarea className="textarea" style={{ minHeight: 160, fontFamily: 'var(--sans)' }} value={draft.content ?? ''} onChange={(e) => setDraft({ ...draft, content: e.target.value })} /></div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn primary" onClick={() => void save()}><Save size={12} /> Save</button>
              <button className="btn danger" onClick={() => void remove()}><Trash2 size={12} /> Delete</button>
              <span className="muted small">scope: {selected.scope}{selected.agentId ? ` (${agents.find((a) => a.id === selected.agentId)?.name ?? 'agent'})` : ''} · updated {timeAgo(selected.updatedAt)}</span>
            </div>
            <div className="card" style={{ marginTop: 14 }}><Markdown text={draft.content ?? ''} /></div>
          </div>
        )}
      </div>
    </div>
  );
}
