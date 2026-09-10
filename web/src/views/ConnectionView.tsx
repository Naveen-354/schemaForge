import React, { useEffect, useState } from 'react';
import { RefreshCw, Boxes, Play, Trash2, Save, Bot, Zap, FunctionSquare, Table2, ShieldCheck } from 'lucide-react';
import { api, type LintFinding } from '../api';
import { openDiagram, openSql, openTable, useStore } from '../store';
import { Badge, Empty, KV, timeAgo } from '../components/ui';

export function ConnectionView({ connectionId, initialTab }: { connectionId: string; initialTab?: string }) {
  const conn = useStore((s) => s.connections.find((c) => c.id === connectionId));
  const snap = useStore((s) => s.schemas[connectionId]);
  const loading = useStore((s) => s.schemaLoading[connectionId]);
  const st = useStore.getState;
  const [tab, setTab] = useState<'overview' | 'tables' | 'routines' | 'triggers' | 'quality' | 'settings'>((initialTab as never) ?? 'overview');
  const [findings, setFindings] = useState<LintFinding[] | null>(null);
  const [test, setTest] = useState<{ ok: boolean; serverVersion?: string; error?: string } | null>(null);
  const [form, setForm] = useState({ name: '', host: '', port: '', database: '', username: '', password: '', schemas: '', readOnly: false });
  useEffect(() => { if (initialTab) setTab(initialTab as never); }, [initialTab]);
  useEffect(() => { st().select({ connectionId }); if (!snap) void st().loadSchema(connectionId); }, [connectionId]);
  useEffect(() => { if (tab === 'quality') void api.lint(connectionId).then((r) => setFindings(r.findings)); }, [tab, connectionId, snap?.capturedAt]);
  useEffect(() => { if (conn) setForm({ name: conn.name, host: conn.host ?? '', port: String(conn.port ?? ''), database: conn.database, username: conn.username ?? '', password: '', schemas: conn.schemas.join(', '), readOnly: conn.readOnly }); }, [conn?.id, conn?.updatedAt]);
  if (!conn) return <Empty>Connection not found.</Empty>;
  const runTest = async () => { setTest(null); const r = await api.testConnection(connectionId); setTest(r); void st().reload('connections'); if (r.ok) void st().loadSchema(connectionId, true); };
  const save = async () => {
    await api.updateConnection(connectionId, { name: form.name, host: form.host || undefined, port: form.port ? Number(form.port) : undefined, database: form.database, username: form.username || undefined, password: form.password || undefined, schemas: form.schemas.split(',').map((s) => s.trim()).filter(Boolean), readOnly: form.readOnly });
    st().toast('Connection saved', 'success');
    void st().reload('connections');
  };
  const remove = async () => { if (!window.confirm(`Delete connection "${conn.name}"?`)) return; await api.deleteConnection(connectionId); st().closeTab(`connection:${connectionId}`); void st().reload('connections'); };
  const tables = snap?.tables.filter((t) => t.kind === 'table') ?? [];
  const views = snap?.tables.filter((t) => t.kind !== 'table') ?? [];
  const fkCount = tables.reduce((n, t) => n + t.foreignKeys.length, 0);
  return (
    <>
      <div className="sql-toolbar">
        <span className="status-dot" style={{ background: conn.status === 'connected' ? 'var(--green)' : conn.status === 'error' ? 'var(--red)' : 'var(--fg-3)' }} />
        <strong>{conn.name}</strong><Badge>{conn.engine}</Badge>{conn.readOnly && <Badge className="yellow">read-only</Badge>}
        <span className="dim small">{conn.engine === 'sqlite' ? conn.filePath : `${conn.username ?? ''}@${conn.host}:${conn.port}/${conn.database}`}</span>
        <span className="grow" />
        <button className="btn sm" onClick={() => void runTest()}><ShieldCheck size={12} /> Test</button>
        <button className="btn sm" onClick={() => void st().loadSchema(connectionId, true)}><RefreshCw size={12} className={loading ? 'pulse' : ''} /> Refresh schema</button>
        <button className="btn sm" onClick={() => openDiagram(connectionId)}><Boxes size={12} /> Diagram</button>
        <button className="btn sm" onClick={() => openSql('', connectionId)}><Play size={12} /> New query</button>
        <button className="btn sm" onClick={() => st().setModal({ kind: 'task', params: { title: 'Review the database design and identify normalization, indexing and naming problems' } })}><Bot size={12} /> Review with agent</button>
      </div>
      <div className="subtabs">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button>
        <button className={tab === 'tables' ? 'active' : ''} onClick={() => setTab('tables')}><Table2 size={11} /> Tables ({tables.length})</button>
        <button className={tab === 'routines' ? 'active' : ''} onClick={() => setTab('routines')}><FunctionSquare size={11} /> Routines ({snap?.routines.length ?? 0})</button>
        <button className={tab === 'triggers' ? 'active' : ''} onClick={() => setTab('triggers')}><Zap size={11} /> Triggers ({snap?.triggers.length ?? 0})</button>
        <button className={tab === 'quality' ? 'active' : ''} onClick={() => setTab('quality')}>Quality</button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>Settings</button>
      </div>
      <div className="panel-body">
        {tab === 'overview' && (
          <div style={{ padding: 12 }}>
            {conn.lastError && <div className="card" style={{ borderColor: '#7a3b40', marginBottom: 10 }}><Badge status="error">connection error</Badge> {conn.lastError}</div>}
            {test && <div className="card" style={{ marginBottom: 10 }}>{test.ok ? <><Badge status="ok">ok</Badge> {test.serverVersion}</> : <><Badge status="error">failed</Badge> {test.error}</>}</div>}
            <div className="grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))', marginBottom: 12 }}>
              <div className="stat"><span className="n">{tables.length}</span><span className="l">tables</span></div>
              <div className="stat"><span className="n">{views.length}</span><span className="l">views</span></div>
              <div className="stat"><span className="n">{fkCount}</span><span className="l">foreign keys</span></div>
              <div className="stat"><span className="n">{tables.reduce((n, t) => n + t.indexes.length, 0)}</span><span className="l">indexes</span></div>
              <div className="stat"><span className="n">{tables.reduce((n, t) => n + (t.rowEstimate ?? 0), 0).toLocaleString()}</span><span className="l">rows (est.)</span></div>
            </div>
            <KV rows={[['Status', <Badge status={conn.status === 'connected' ? 'ok' : conn.status === 'error' ? 'error' : ''}>{conn.status}</Badge>], ['Schemas', snap?.schemas.join(', ') ?? '—'], ['Schema snapshot', snap ? timeAgo(snap.capturedAt) : 'not loaded'], ['Created', timeAgo(conn.createdAt)]]} />
          </div>
        )}
        {tab === 'tables' && (
          <table className="data">
            <thead><tr><th>Schema</th><th>Name</th><th>Kind</th><th>Columns</th><th>PK</th><th>FKs</th><th>Indexes</th><th>Rows</th></tr></thead>
            <tbody>{(snap?.tables ?? []).map((t) => <tr key={`${t.schema}.${t.name}`} className="clickable" onClick={() => openTable(connectionId, t.schema, t.name)}><td className="dim">{t.schema}</td><td className="mono">{t.name}</td><td>{t.kind}</td><td className="num">{t.columns.length}</td><td className="mono dim">{t.primaryKey.join(', ')}</td><td className="num">{t.foreignKeys.length}</td><td className="num">{t.indexes.length}</td><td className="num">{t.rowEstimate?.toLocaleString() ?? ''}</td></tr>)}</tbody>
          </table>
        )}
        {tab === 'routines' && (
          <div style={{ padding: 10 }}>
            {(snap?.routines ?? []).length === 0 && <Empty>No functions or procedures.</Empty>}
            {(snap?.routines ?? []).map((r) => <div key={`${r.schema}.${r.name}.${r.arguments}`} className="card" style={{ marginBottom: 6 }}><div className="row"><Badge>{r.kind}</Badge><code>{r.schema}.{r.name}({r.arguments})</code>{r.returnType && <span className="dim small">→ {r.returnType}</span>}<span className="muted small">{r.language}</span></div>{r.definition && <pre className="mono small" style={{ whiteSpace: 'pre-wrap', marginTop: 6, maxHeight: 200, overflow: 'auto' }}>{r.definition}</pre>}</div>)}
          </div>
        )}
        {tab === 'triggers' && (
          <div style={{ padding: 10 }}>
            {(snap?.triggers ?? []).length === 0 && <Empty>No triggers.</Empty>}
            {(snap?.triggers ?? []).map((t) => <div key={`${t.schema}.${t.table}.${t.name}`} className="card" style={{ marginBottom: 6 }}><div className="row"><code>{t.name}</code><span className="dim small">{t.timing} {t.event} on {t.table}</span></div>{t.definition && <pre className="mono small" style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{t.definition}</pre>}</div>)}
          </div>
        )}
        {tab === 'quality' && (
          <div style={{ padding: 10 }}>
            {!findings && <Empty>Running checks…</Empty>}
            {findings && findings.length === 0 && <Empty>No issues found.</Empty>}
            {findings && findings.length > 0 && <div className="dim small" style={{ marginBottom: 8 }}>{findings.length} findings · deterministic checks (no AI). Ask an agent to review for deeper analysis.</div>}
            {findings?.map((f, i) => (
              <div key={i} className="card" style={{ marginBottom: 6 }}>
                <div className="row"><Badge className={f.severity === 'high' ? 'red' : f.severity === 'medium' ? 'yellow' : ''}>{f.severity}</Badge><code>{f.code}</code><a style={{ cursor: 'pointer' }} onClick={() => { const t = snap?.tables.find((x) => x.name === f.table); if (t) openTable(connectionId, t.schema, t.name); }}>{f.table}{f.column ? `.${f.column}` : ''}</a></div>
                <div style={{ marginTop: 4 }}>{f.message}</div>
                {f.suggestion && (/^(CREATE|ALTER|DROP)/.test(f.suggestion) ? <div className="row" style={{ marginTop: 4 }}><code className="grow">{f.suggestion}</code><button className="btn sm" onClick={() => openSql(f.suggestion!, connectionId, 'Fix')}>Open in editor</button></div> : <div className="dim small" style={{ marginTop: 4 }}>{f.suggestion}</div>)}
              </div>
            ))}
          </div>
        )}
        {tab === 'settings' && (
          <div style={{ padding: 12, maxWidth: 640 }} className="col">
            <div className="field"><label>Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            {conn.engine === 'postgres' && (
              <>
                <div className="grid cols-3">
                  <div className="field"><label>Host</label><input className="input" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} /></div>
                  <div className="field"><label>Port</label><input className="input" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} /></div>
                  <div className="field"><label>Database</label><input className="input" value={form.database} onChange={(e) => setForm({ ...form, database: e.target.value })} /></div>
                </div>
                <div className="grid cols-2">
                  <div className="field"><label>Username</label><input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
                  <div className="field"><label>Password {conn.hasPassword ? <span className="badge ok">set</span> : null}</label><input className="input" type="password" placeholder="leave blank to keep" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
                </div>
                <div className="field"><label>Schemas (comma separated; blank = all)</label><input className="input" value={form.schemas} onChange={(e) => setForm({ ...form, schemas: e.target.value })} /></div>
              </>
            )}
            <label className="row small"><input type="checkbox" checked={form.readOnly} onChange={(e) => setForm({ ...form, readOnly: e.target.checked })} /> Read-only connection (all writes and DDL rejected, for users and agents)</label>
            <div className="row"><button className="btn primary" onClick={() => void save()}><Save size={12} /> Save</button><button className="btn danger" onClick={() => void remove()}><Trash2 size={12} /> Delete connection</button></div>
          </div>
        )}
      </div>
    </>
  );
}
