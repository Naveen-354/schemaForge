import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Play, Bot, Save, FlaskConical, Search, Loader2 } from 'lucide-react';
import type { SqlClassification } from '@schemaforge/shared';
import { api, ApiError } from '../api';
import { openTask, useStore } from '../store';
import { Badge, fmtMs } from '../components/ui';
import { SqlEditor } from './SqlEditor';
import { ResultsTable } from './ResultsTable';

export function SqlView({ tabId }: { tabId: string }) {
  const tab = useStore((s) => s.sqlTabs[tabId]);
  const connections = useStore((s) => s.connections);
  const projectId = useStore((s) => s.projectId);
  const savedQueries = useStore((s) => s.savedQueries);
  const st = useStore.getState;
  const conn = connections.find((c) => c.id === tab?.connectionId) ?? connections[0];
  const snapshot = useStore((s) => (conn ? s.schemas[conn.id] : undefined));
  const [cls, setCls] = useState<SqlClassification | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [selected, setSelected] = useState('');
  const [view, setView] = useState<'results' | 'plan'>('results');
  const clsTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { if (!tab) st().updateSqlTab(tabId, { sql: '', connectionId: conn?.id ?? null }); }, [tab, tabId, conn?.id]);
  useEffect(() => { if (conn && !snapshot) void st().loadSchema(conn.id); }, [conn?.id, snapshot]);
  useEffect(() => { if (conn) st().select({ connectionId: conn.id }); }, [conn?.id]);

  const sqlText = tab?.sql ?? '';
  useEffect(() => {
    clearTimeout(clsTimer.current);
    if (!sqlText.trim()) { setCls(null); return; }
    clsTimer.current = setTimeout(() => { void api.classify(sqlText).then(setCls).catch(() => undefined); }, 250);
  }, [sqlText]);

  // Selection (or whole editor) is exposed as AI context.
  useEffect(() => {
    const h = setTimeout(() => st().select({ sql: (selected || sqlText).trim() || undefined }), 200);
    return () => clearTimeout(h);
  }, [selected, sqlText]);

  const run = async (text: string, confirmRisk = false) => {
    if (!conn || !text.trim()) return;
    st().updateSqlTab(tabId, { running: true });
    setView('results');
    try {
      const out = await api.execute({ connectionId: conn.id, sql: text, dryRun, confirmRisk });
      st().updateSqlTab(tabId, { outcome: out, plan: null, running: false });
      st().setBottom('results', true);
      if (out.result) st().select({ resultSummary: `${out.result.rowCount} rows; columns: ${out.result.columns.map((c) => c.name).join(', ')}; first row: ${JSON.stringify(out.result.rows[0] ?? null)}` });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { classification: SqlClassification; message: string };
        if (window.confirm(`${body.message}\n\nStatement type: ${body.classification.statementType}\nRisk: ${body.classification.risk}\n\nExecute anyway${dryRun ? ' (dry run, will roll back)' : ''}?`)) return run(text, true);
        st().updateSqlTab(tabId, { running: false });
        return;
      }
      if (e instanceof ApiError && e.status === 400 && (e.body as { error?: string })?.error) {
        st().updateSqlTab(tabId, { outcome: e.body as never, running: false });
        st().setBottom('results', true);
        return;
      }
      st().updateSqlTab(tabId, { running: false });
      st().toast((e as Error).message, 'error');
    }
  };

  const explain = async (analyze = false) => {
    if (!conn) return;
    const text = selected.trim() || sqlText;
    st().updateSqlTab(tabId, { running: true });
    try {
      const { plan } = await api.explain({ connectionId: conn.id, sql: text, analyze });
      st().updateSqlTab(tabId, { plan, running: false });
      setView('plan');
    } catch (e) { st().updateSqlTab(tabId, { running: false }); st().toast((e as Error).message, 'error'); }
  };

  const ask = async (question: string) => {
    if (!projectId) return;
    const text = selected.trim() || sqlText;
    const t = await api.ask({ projectId, question, connectionId: conn?.id ?? null, context: { sql: text, queryResultSummary: st().selection.resultSummary } });
    st().toast('Asked the assistant', 'success');
    void st().reload('tasks');
    openTask(t.id);
  };

  const save = async () => {
    if (!projectId) return;
    const name = window.prompt('Save query as:', savedQueries.find((q) => q.id === tab?.savedQueryId)?.name ?? '');
    if (!name) return;
    if (tab?.savedQueryId) await api.updateSavedQuery(tab.savedQueryId, { name, sql: sqlText, connectionId: conn?.id ?? null });
    else { const q = await api.saveQuery({ projectId, connectionId: conn?.id ?? null, name, sql: sqlText, description: '' }); st().updateSqlTab(tabId, { savedQueryId: q.id }); }
    void st().reload('savedQueries');
    st().toast('Query saved', 'success');
  };

  const outcome = tab?.outcome;
  const running = tab?.running;
  const riskBadge = useMemo(() => cls && <Badge status={cls.risk} title={cls.reasons.join('; ')}>{cls.statementType}{cls.risk !== 'safe' ? ` · ${cls.risk}` : ''}</Badge>, [cls]);

  return (
    <>
      <div className="sql-toolbar">
        <select className="select" value={conn?.id ?? ''} onChange={(e) => st().updateSqlTab(tabId, { connectionId: e.target.value })}>
          {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="btn primary sm" disabled={!conn || running} onClick={() => void run(selected.trim() || sqlText)} title="Run selection or statement (Ctrl+Enter)">{running ? <Loader2 size={12} className="spin" /> : <Play size={12} />} Run</button>
        <button className="btn sm" disabled={!conn || running} onClick={() => void explain(false)} title="EXPLAIN"><Search size={12} /> Explain</button>
        <label className="row small" title="Execute inside a transaction that is rolled back"><input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> <FlaskConical size={11} /> dry run</label>
        {riskBadge}
        <span className="grow" />
        <button className="btn sm" onClick={() => void ask('Explain this query in plain language.')}><Bot size={12} /> Explain</button>
        <button className="btn sm" onClick={() => void ask('Why is this query slow? Inspect the plan and suggest optimizations.')}><Bot size={12} /> Why slow?</button>
        <button className="btn sm" onClick={() => void ask('Review this SQL for correctness, performance and safety.')}><Bot size={12} /> Review</button>
        <select className="select" value="" onChange={(e) => { const q = savedQueries.find((x) => x.id === e.target.value); if (q) st().updateSqlTab(tabId, { sql: q.sql, savedQueryId: q.id, connectionId: q.connectionId ?? tab?.connectionId ?? null }); }}>
          <option value="">Saved queries…</option>{savedQueries.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
        </select>
        <button className="btn sm" onClick={() => void save()}><Save size={12} /> Save</button>
      </div>
      <PanelGroup direction="vertical">
        <Panel defaultSize={55} minSize={15}>
          <SqlEditor value={sqlText} onChange={(v) => st().updateSqlTab(tabId, { sql: v })} onRun={(text) => void run(text)} onSelection={setSelected} snapshot={snapshot} engine={conn?.engine} />
        </Panel>
        <PanelResizeHandle className="resize-handle" />
        <Panel defaultSize={45} minSize={10}>
          <div className="panel" style={{ height: '100%' }}>
            <div className="subtabs">
              <button className={view === 'results' ? 'active' : ''} onClick={() => setView('results')}>Results</button>
              <button className={view === 'plan' ? 'active' : ''} onClick={() => setView('plan')}>Plan</button>
              <span className="spacer" />
              {outcome?.result && <span className="small dim" style={{ alignSelf: 'center' }}>{outcome.result.rowCount} rows · {fmtMs(outcome.result.durationMs)}{outcome.result.truncated ? ' · truncated' : ''}</span>}
            </div>
            <div className="panel" style={{ flex: 1 }}>
              {view === 'plan' ? (tab?.plan ? <pre className="panel-body mono" style={{ margin: 0, padding: 10 }}>{tab.plan}</pre> : <div className="empty">Click Explain to see the query plan.</div>)
                : !outcome ? <div className="empty">Ctrl+Enter runs the statement under the cursor · Ctrl+Shift+Enter runs everything</div>
                : outcome.error ? <div className="panel-body pad"><div className="row" style={{ alignItems: 'flex-start' }}><Badge status="error">SQL error</Badge><span style={{ whiteSpace: 'pre-wrap' }}>{outcome.error}</span></div><div style={{ marginTop: 8 }}><button className="btn sm" onClick={() => void ask(`Why did this query fail? Error: ${outcome.error}`)}><Bot size={12} /> Why did it fail?</button></div></div>
                : <ResultsTable result={outcome.result!} />}
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </>
  );
}
