import React, { useEffect, useState } from 'react';
import { KeyRound, GitBranch, Zap, Boxes, Play, Bot, Copy, RefreshCw } from 'lucide-react';
import { api, type TableDetail } from '../api';
import { openDiagram, openSql, openTable, openTask, useStore } from '../store';
import { Badge, Empty } from '../components/ui';

export function TableView({ connectionId, schema, name }: { connectionId: string; schema: string; name: string }) {
  const [detail, setDetail] = useState<TableDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'columns' | 'keys' | 'indexes' | 'ddl' | 'quality'>('columns');
  const st = useStore.getState;
  const projectId = useStore((s) => s.projectId);
  const conn = useStore((s) => s.connections.find((c) => c.id === connectionId));
  const snapVersion = useStore((s) => s.schemas[connectionId]?.capturedAt);

  useEffect(() => {
    setError(null);
    api.table(connectionId, `${schema}.${name}`).then(setDetail).catch((e) => setError(e.message));
  }, [connectionId, schema, name, snapVersion]);
  useEffect(() => { st().select({ connectionId, table: { schema, name } }); }, [connectionId, schema, name]);

  if (error) return <div className="panel-body pad"><Badge status="error">Error</Badge> {error} <button className="btn sm" onClick={() => void st().loadSchema(connectionId, true)}>Refresh schema</button></div>;
  if (!detail) return <Empty>Loading…</Empty>;
  const t = detail.table;
  const ref = conn?.engine === 'sqlite' ? name : `${schema}.${name}`;
  const ask = (q: string) => {
    if (!projectId) return;
    void api.ask({ projectId, question: q, connectionId, context: { table: { schema, name } } }).then((task) => { openTask(task.id); void st().reload('tasks'); });
  };
  return (
    <>
      <div className="sql-toolbar">
        <strong>{schema}.{name}</strong><Badge>{t.kind}</Badge>
        <span className="dim small">{t.columns.length} columns · {t.rowEstimate != null ? `~${t.rowEstimate.toLocaleString()} rows` : 'rows unknown'} · PK {t.primaryKey.join(', ') || '—'}</span>
        <span className="grow" />
        <button className="btn sm" onClick={() => openSql(`SELECT *\nFROM ${ref}\nLIMIT 100;`, connectionId, `${name} · rows`)}><Play size={12} /> Select rows</button>
        <button className="btn sm" onClick={() => openSql(`SELECT COUNT(*) AS rows FROM ${ref};`, connectionId, `${name} · count`)}>Count</button>
        <button className="btn sm" onClick={() => openDiagram(connectionId, `${schema}.${name}`)}><Boxes size={12} /> Diagram</button>
        <button className="btn sm" onClick={() => ask('Is this table properly indexed?')}><Bot size={12} /> Indexes?</button>
        <button className="btn sm" onClick={() => st().setModal({ kind: 'task', params: { title: `Review the ${name} table design and suggest improvements` } })}><Bot size={12} /> Review with agent</button>
        <button className="btn ghost sm icon" title="Refresh schema" onClick={() => void st().loadSchema(connectionId, true)}><RefreshCw size={12} /></button>
      </div>
      <div className="subtabs">
        <button className={tab === 'columns' ? 'active' : ''} onClick={() => setTab('columns')}>Columns</button>
        <button className={tab === 'keys' ? 'active' : ''} onClick={() => setTab('keys')}><GitBranch size={11} /> Keys & relationships ({t.foreignKeys.length + detail.referencedBy.length})</button>
        <button className={tab === 'indexes' ? 'active' : ''} onClick={() => setTab('indexes')}><Zap size={11} /> Indexes ({t.indexes.length})</button>
        <button className={tab === 'ddl' ? 'active' : ''} onClick={() => setTab('ddl')}>DDL</button>
        <button className={tab === 'quality' ? 'active' : ''} onClick={() => setTab('quality')}>Quality {detail.findings.length ? <span className={`badge ${detail.findings.some((f) => f.severity === 'high') ? 'red' : 'yellow'}`}>{detail.findings.length}</span> : null}</button>
      </div>
      <div className="panel-body">
        {tab === 'columns' && (
          <table className="data">
            <thead><tr><th>#</th><th>Column</th><th>Type</th><th>Nullable</th><th>Default</th><th>Keys</th><th>Comment</th></tr></thead>
            <tbody>
              {t.columns.map((c) => {
                const fk = t.foreignKeys.find((f) => f.columns.includes(c.name));
                return (
                  <tr key={c.name}>
                    <td className="num muted">{c.ordinal}</td>
                    <td className="mono">{c.name}</td>
                    <td className="mono dim">{c.dataType}</td>
                    <td>{c.nullable ? <span className="muted">null</span> : <span>not null</span>}</td>
                    <td className="mono dim">{c.defaultValue ?? ''}</td>
                    <td>
                      {c.isPrimaryKey && <span className="badge yellow"><KeyRound size={9} /> PK</span>}{' '}
                      {fk && <span className="badge cyan" style={{ cursor: 'pointer' }} onClick={() => openTable(connectionId, fk.refSchema, fk.refTable)}><GitBranch size={9} /> {fk.refTable}.{fk.refColumns[fk.columns.indexOf(c.name)]}</span>}
                    </td>
                    <td className="dim">{c.comment ?? ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {tab === 'keys' && (
          <div className="pad" style={{ padding: 12 }}>
            <div className="section"><h4>Primary key</h4>{t.primaryKey.length ? <code>{t.primaryKey.join(', ')}</code> : <span className="muted">none</span>}</div>
            <div className="section"><h4>References (outgoing)</h4>
              {t.foreignKeys.length === 0 && <span className="muted">none</span>}
              {t.foreignKeys.map((fk) => <div key={fk.name} className="row small" style={{ padding: '2px 0' }}><code>{fk.columns.join(', ')}</code> → <a style={{ cursor: 'pointer' }} onClick={() => openTable(connectionId, fk.refSchema, fk.refTable)}>{fk.refSchema}.{fk.refTable}</a> <code>({fk.refColumns.join(', ')})</code>{fk.onDelete && <span className="muted">on delete {fk.onDelete}</span>}</div>)}
            </div>
            <div className="section"><h4>Referenced by (incoming)</h4>
              {detail.referencedBy.length === 0 && <span className="muted">none</span>}
              {detail.referencedBy.map((r) => <div key={r.table} className="row small" style={{ padding: '2px 0' }}><a style={{ cursor: 'pointer' }} onClick={() => openTable(connectionId, r.table.split('.')[0], r.table.split('.')[1])}>{r.table}</a> via <code>{r.foreignKeys.map((fk) => fk.columns.join(', ')).join('; ')}</code></div>)}
            </div>
            <div className="section"><h4>Constraints</h4>
              {t.constraints.length === 0 && <span className="muted">none</span>}
              {t.constraints.map((c) => <div key={c.name} className="small mono" style={{ padding: '2px 0' }}><span className="badge">{c.type}</span> {c.name}: {c.definition}</div>)}
            </div>
          </div>
        )}
        {tab === 'indexes' && (
          <table className="data">
            <thead><tr><th>Index</th><th>Columns</th><th>Unique</th><th>Primary</th><th>Definition</th></tr></thead>
            <tbody>{t.indexes.map((i) => <tr key={i.name}><td className="mono">{i.name}</td><td className="mono">{i.columns.join(', ')}</td><td>{i.unique ? 'yes' : ''}</td><td>{i.primary ? 'yes' : ''}</td><td className="mono dim">{i.definition ?? ''}</td></tr>)}</tbody>
          </table>
        )}
        {tab === 'ddl' && (
          <div style={{ padding: 10 }}>
            <div className="row" style={{ marginBottom: 6 }}><button className="btn sm" onClick={() => { void navigator.clipboard.writeText(detail.ddl); st().toast('DDL copied', 'success'); }}><Copy size={11} /> Copy</button><button className="btn sm" onClick={() => openSql(detail.ddl, connectionId, `${name} · DDL`)}>Open in editor</button></div>
            <pre className="mono" style={{ background: 'var(--bg-2)', padding: 10, borderRadius: 4, whiteSpace: 'pre-wrap' }}>{detail.ddl}</pre>
          </div>
        )}
        {tab === 'quality' && (
          <div style={{ padding: 10 }}>
            {detail.findings.length === 0 && <Empty>No issues found by the deterministic checks.</Empty>}
            {detail.findings.map((f, i) => (
              <div key={i} className="card" style={{ marginBottom: 6 }}>
                <div className="row"><Badge className={f.severity === 'high' ? 'red' : f.severity === 'medium' ? 'yellow' : ''}>{f.severity}</Badge><code>{f.code}</code>{f.column && <code>{f.column}</code>}</div>
                <div style={{ marginTop: 4 }}>{f.message}</div>
                {f.suggestion && (/^(CREATE|ALTER|DROP)/.test(f.suggestion)
                  ? <div className="row" style={{ marginTop: 4 }}><code className="grow" style={{ whiteSpace: 'pre-wrap' }}>{f.suggestion}</code><button className="btn sm" onClick={() => openSql(f.suggestion!, connectionId, 'Fix')}>Open in editor</button></div>
                  : <div className="dim small" style={{ marginTop: 4 }}>{f.suggestion}</div>)}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
