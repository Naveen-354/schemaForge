import React, { useMemo } from 'react';
import type { AgentStatus, TaskStatus } from '@schemaforge/shared';

export function Badge({ status, children, className = '', dot, pulse, title }: { status?: string; children?: React.ReactNode; className?: string; dot?: boolean; pulse?: boolean; title?: string }) {
  return <span className={`badge ${status ?? ''} ${dot ? 'dot' : ''} ${pulse ? 'pulse' : ''} ${className}`} title={title}>{children ?? status}</span>;
}

export const STATUS_COLOR: Record<AgentStatus | TaskStatus, string> = {
  IDLE: 'var(--fg-3)', QUEUED: 'var(--fg-2)', RUNNING: 'var(--green)', WAITING: 'var(--fg-2)', WAITING_FOR_APPROVAL: 'var(--yellow)',
  PAUSED: 'var(--yellow)', COMPLETED: 'var(--accent)', FAILED: 'var(--red)', STOPPED: 'var(--fg-3)', CANCELLED: 'var(--fg-3)',
  TODO: 'var(--fg-3)', BLOCKED: 'var(--yellow)',
};

export function StatusDot({ status }: { status: AgentStatus | TaskStatus }) {
  const live = status === 'RUNNING' || status === 'WAITING_FOR_APPROVAL';
  return <span className={`status-dot ${live ? 'pulse-dot' : ''}`} style={{ background: STATUS_COLOR[status] ?? 'var(--fg-3)' }} />;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function clock(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <div className="kv">
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <div className="k">{k}</div>
          <div className="v">{v ?? <span className="muted">—</span>}</div>
        </React.Fragment>
      ))}
    </div>
  );
}

// ---------- minimal markdown renderer (no dependency) ----------

function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const s = m[0];
    if (s.startsWith('`')) out.push(<code key={k++}>{s.slice(1, -1)}</code>);
    else if (s.startsWith('**')) out.push(<strong key={k++}>{s.slice(2, -2)}</strong>);
    else if (s.startsWith('*')) out.push(<em key={k++}>{s.slice(1, -1)}</em>);
    else {
      const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(s)!;
      out.push(<a key={k++} href={mm[2]} target="_blank" rel="noreferrer">{mm[1]}</a>);
    }
    last = m.index + s.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const blocks = useMemo(() => renderMarkdown(text), [text]);
  return <div className={`md ${className}`}>{blocks}</div>;
}

function renderMarkdown(src: string): React.ReactNode[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(<pre key={key++} data-lang={lang}><code>{buf.join('\n')}</code></pre>);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(h[1].length, 3);
      const Tag = (`h${level}`) as 'h1' | 'h2' | 'h3';
      out.push(<Tag key={key++}>{inline(h[2])}</Tag>);
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: React.ReactNode[] = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) {
        items.push(<li key={key++}>{inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>);
        i++;
      }
      out.push(ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>);
      continue;
    }
    if (/^\|/.test(line) && /^\|?\s*:?-+/.test(lines[i + 1] ?? '')) {
      const header = line.split('|').slice(1, -1).map((s) => s.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i].split('|').slice(1, -1).map((s) => s.trim())); i++; }
      out.push(
        <div key={key++} style={{ overflowX: 'auto' }}>
          <table><thead><tr>{header.map((hh, j) => <th key={j}>{inline(hh)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody></table>
        </div>,
      );
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(<blockquote key={key++}>{inline(buf.join(' '))}</blockquote>);
      continue;
    }
    if (/^-{3,}$/.test(line.trim())) { out.push(<hr key={key++} />); i++; continue; }
    if (line.trim() === '') { i++; continue; }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^(```|#{1,6}\s|\s*[-*]\s|\s*\d+\.\s|\||>)/.test(lines[i])) buf.push(lines[i++]);
    out.push(<p key={key++}>{inline(buf.join(' '))}</p>);
  }
  return out;
}

export function ErrorBox({ error, actions }: { error: string; actions?: React.ReactNode }) {
  return (
    <div className="card" style={{ borderColor: '#7a3b40' }}>
      <div className="row" style={{ marginBottom: actions ? 8 : 0 }}><span className="badge red">Error</span><span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{error}</span></div>
      {actions && <div className="row wrap">{actions}</div>}
    </div>
  );
}
