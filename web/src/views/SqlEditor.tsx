import React, { useEffect, useRef } from 'react';
import { EditorState, Compartment, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { sql, PostgreSQL, SQLite } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import type { SchemaSnapshot } from '@schemaforge/shared';

export interface SqlEditorProps {
  value: string;
  onChange(v: string): void;
  onRun(sqlText: string): void;
  onSelection?(selected: string): void;
  snapshot?: SchemaSnapshot | null;
  engine?: 'postgres' | 'sqlite';
}

const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--bg)' },
  '.cm-gutters': { backgroundColor: 'var(--bg-2)', borderRight: '1px solid var(--border)', color: 'var(--fg-3)' },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.04)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#2c4a78 !important' },
  '.cm-tooltip': { backgroundColor: 'var(--bg-3)', border: '1px solid var(--border-2)' },
}, { dark: true });

function schemaConfig(snapshot?: SchemaSnapshot | null): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!snapshot) return out;
  const multi = snapshot.schemas.length > 1;
  for (const t of snapshot.tables) {
    out[t.name] = t.columns.map((c) => c.name);
    if (multi || t.schema !== 'main') out[`${t.schema}.${t.name}`] = t.columns.map((c) => c.name);
  }
  return out;
}

/** Statement under the cursor, split on blank lines / semicolons. */
function statementAt(doc: string, pos: number): string {
  const parts: { start: number; end: number }[] = [];
  let start = 0;
  for (let i = 0; i <= doc.length; i++) {
    if (i === doc.length || doc[i] === ';' || (doc[i] === '\n' && doc[i + 1] === '\n')) {
      parts.push({ start, end: i === doc.length ? i : doc[i] === ';' ? i + 1 : i });
      start = i + 1;
    }
  }
  const p = parts.find((x) => pos >= x.start && pos <= x.end) ?? parts[parts.length - 1];
  return p ? doc.slice(p.start, p.end).trim() : doc.trim();
}

export function SqlEditor({ value, onChange, onRun, onSelection, snapshot, engine }: SqlEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const lang = useRef(new Compartment());
  const cbs = useRef({ onChange, onRun, onSelection });
  cbs.current = { onChange, onRun, onSelection };

  useEffect(() => {
    if (!host.current) return;
    const runKey = keymap.of([
      { key: 'Ctrl-Enter', mac: 'Cmd-Enter', run: (v) => { const sel = v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to); cbs.current.onRun(sel.trim() || statementAt(v.state.doc.toString(), v.state.selection.main.head)); return true; } },
      { key: 'Ctrl-Shift-Enter', mac: 'Cmd-Shift-Enter', run: (v) => { cbs.current.onRun(v.state.doc.toString()); return true; } },
    ]);
    const state = EditorState.create({
      doc: value,
      extensions: [
        Prec.highest(runKey), basicSetup, oneDark, theme,
        lang.current.of(sql({ dialect: engine === 'sqlite' ? SQLite : PostgreSQL, schema: schemaConfig(snapshot), upperCaseKeywords: true })),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cbs.current.onChange(u.state.doc.toString());
          if (u.selectionSet || u.docChanged) {
            const s = u.state.selection.main;
            cbs.current.onSelection?.(u.state.sliceDoc(s.from, s.to));
          }
        }),
      ],
    });
    view.current = new EditorView({ state, parent: host.current });
    return () => { view.current?.destroy(); view.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch({ effects: lang.current.reconfigure(sql({ dialect: engine === 'sqlite' ? SQLite : PostgreSQL, schema: schemaConfig(snapshot), upperCaseKeywords: true })) });
  }, [snapshot, engine]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== value) v.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
  }, [value]);

  return <div className="editor-host" ref={host} />;
}

export { statementAt };
