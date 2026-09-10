import React, { useMemo, useState } from 'react';
import { Download, Copy } from 'lucide-react';
import type { QueryResult } from '@schemaforge/shared';
import { useStore } from '../store';
import { fmtMs } from '../components/ui';

const PAGE = 100;

function cell(v: unknown): { text: string; cls: string } {
  if (v === null || v === undefined) return { text: 'NULL', cls: 'null' };
  if (typeof v === 'number' || typeof v === 'bigint') return { text: String(v), cls: 'num' };
  if (typeof v === 'object') return { text: JSON.stringify(v), cls: '' };
  return { text: String(v), cls: '' };
}

export function ResultsTable({ result }: { result: QueryResult }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(result.rows.length / PAGE));
  const rows = useMemo(() => result.rows.slice(page * PAGE, page * PAGE + PAGE), [result, page]);
  const toast = useStore((s) => s.toast);
  const exportCsv = () => {
    const esc = (v: unknown) => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [result.columns.map((c) => esc(c.name)).join(','), ...result.rows.map((r) => r.map(esc).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'results.csv';
    a.click();
  };
  const copyJson = () => {
    const objs = result.rows.map((r) => Object.fromEntries(result.columns.map((c, i) => [c.name, r[i]])));
    void navigator.clipboard.writeText(JSON.stringify(objs, null, 2)).then(() => toast('Copied as JSON', 'success'));
  };
  if (result.columns.length === 0) {
    return <div className="panel-body pad"><span className="badge ok">{result.command ?? 'OK'}</span> {result.affectedRows != null ? `${result.affectedRows} row(s) affected` : 'Statement executed'} · {fmtMs(result.durationMs)}</div>;
  }
  return (
    <div className="panel" style={{ height: '100%' }}>
      <div className="filterbar">
        <span className="small dim">{result.rowCount.toLocaleString()} rows{result.truncated ? ' (truncated)' : ''} · {result.columns.length} columns · {fmtMs(result.durationMs)}</span>
        <span className="grow" />
        {pages > 1 && <span className="row small"><button className="btn ghost sm" disabled={page === 0} onClick={() => setPage(page - 1)}>‹</button> page {page + 1}/{pages} <button className="btn ghost sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>›</button></span>}
        <button className="btn ghost sm" onClick={copyJson}><Copy size={11} /> JSON</button>
        <button className="btn ghost sm" onClick={exportCsv}><Download size={11} /> CSV</button>
      </div>
      <div className="results-wrap">
        <table className="data">
          <thead><tr><th className="num">#</th>{result.columns.map((c, i) => <th key={i} title={c.type ?? ''}>{c.name}<span className="muted" style={{ fontWeight: 400, marginLeft: 4 }}>{c.type ?? ''}</span></th>)}</tr></thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}><td className="num muted">{page * PAGE + ri + 1}</td>{r.map((v, ci) => { const c = cell(v); return <td key={ci} className={c.cls} title={c.text}>{c.text.length > 200 ? c.text.slice(0, 200) + '…' : c.text}</td>; })}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
