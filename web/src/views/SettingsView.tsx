import React, { useEffect, useState } from 'react';
import { Save, KeyRound, Cpu } from 'lucide-react';
import { api, type SettingsResponse } from '../api';
import { useStore } from '../store';
import { Badge, KV } from '../components/ui';

export function SettingsView() {
  const [s, setS] = useState<SettingsResponse | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const st = useStore.getState;
  const load = () => api.settings().then((r) => { setS(r); setValues(Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k, v ?? '']))); });
  useEffect(() => { void load(); }, []);
  const save = async () => {
    const body: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(values)) body[k] = v || null;
    for (const [k, v] of Object.entries(secrets)) if (v) body[k] = v;
    await api.saveSettings(body);
    setSecrets({});
    st().toast('Settings saved', 'success');
    await load();
  };
  const clearSecret = async (k: string) => { await api.saveSettings({ [k]: null }); await load(); };
  if (!s) return <div className="empty">Loading…</div>;
  return (
    <div className="panel-body pad" style={{ maxWidth: 820 }}>
      <h2 style={{ marginBottom: 4 }}>Settings</h2>
      <div className="dim small" style={{ marginBottom: 14 }}>SchemaForge v{s.version} · data directory <code>{s.dataDir}</code> · secrets are encrypted at rest with a local master key and never sent to AI providers.</div>

      <div className="section">
        <h4><Cpu size={11} /> AI providers</h4>
        <div className="grid cols-3">
          {s.providers.map((p) => (
            <div key={p.id} className="card">
              <div className="row"><strong>{p.name}</strong><span className="grow" /><Badge status={p.configured ? 'ok' : ''}>{p.configured ? 'configured' : 'not configured'}</Badge></div>
              <KV rows={[['Default model', <code>{p.defaultModel}</code>], ['Base URL', p.baseUrl ?? 'default']]} />
            </div>
          ))}
        </div>
      </div>

      <div className="section">
        <h4><KeyRound size={11} /> Anthropic</h4>
        <div className="grid cols-2">
          <div className="field"><label>API key {s.secrets['anthropic.apiKey'] ? <span className="badge ok">set</span> : null}</label>
            <div className="row"><input className="input grow" type="password" placeholder={s.secrets['anthropic.apiKey'] ? '•••••••• (stored)' : 'sk-ant-…'} value={secrets['anthropic.apiKey'] ?? ''} onChange={(e) => setSecrets({ ...secrets, 'anthropic.apiKey': e.target.value })} />{s.secrets['anthropic.apiKey'] && <button className="btn sm" onClick={() => void clearSecret('anthropic.apiKey')}>clear</button>}</div>
            <span className="muted small">Also read from ANTHROPIC_API_KEY. Default model: claude-opus-5.</span>
          </div>
          <div className="field"><label>Refusal fallbacks (Opus 5 / Fable models)</label>
            <select className="select" value={values['anthropic.fallbacks'] ?? ''} onChange={(e) => setValues({ ...values, 'anthropic.fallbacks': e.target.value })}><option value="">on (server-side fallback to another model if a request is declined)</option><option value="off">off</option></select>
          </div>
        </div>
      </div>

      <div className="section">
        <h4><KeyRound size={11} /> OpenAI-compatible (OpenAI, Ollama, LM Studio, OpenRouter…)</h4>
        <div className="grid cols-2">
          <div className="field"><label>Base URL</label><input className="input" placeholder="https://api.openai.com/v1 or http://localhost:11434/v1" value={values['openai.baseUrl'] ?? ''} onChange={(e) => setValues({ ...values, 'openai.baseUrl': e.target.value })} /></div>
          <div className="field"><label>API key {s.secrets['openai.apiKey'] ? <span className="badge ok">set</span> : null}</label>
            <div className="row"><input className="input grow" type="password" placeholder={s.secrets['openai.apiKey'] ? '•••••••• (stored)' : 'optional for local servers'} value={secrets['openai.apiKey'] ?? ''} onChange={(e) => setSecrets({ ...secrets, 'openai.apiKey': e.target.value })} />{s.secrets['openai.apiKey'] && <button className="btn sm" onClick={() => void clearSecret('openai.apiKey')}>clear</button>}</div>
          </div>
          <div className="field"><label>Default model</label><input className="input" placeholder="gpt-4.1 / llama3.1 / qwen2.5-coder" value={values['openai.defaultModel'] ?? ''} onChange={(e) => setValues({ ...values, 'openai.defaultModel': e.target.value })} /></div>
          <div className="field"><label>Extra models (comma separated)</label><input className="input" value={values['openai.models'] ?? ''} onChange={(e) => setValues({ ...values, 'openai.models': e.target.value })} /></div>
          <div className="field"><label>Price per 1M input tokens (USD, for cost estimates)</label><input className="input" value={values['openai.priceInputPerM'] ?? ''} onChange={(e) => setValues({ ...values, 'openai.priceInputPerM': e.target.value })} /></div>
          <div className="field"><label>Price per 1M output tokens (USD)</label><input className="input" value={values['openai.priceOutputPerM'] ?? ''} onChange={(e) => setValues({ ...values, 'openai.priceOutputPerM': e.target.value })} /></div>
        </div>
      </div>

      <div className="section">
        <h4>Built-in heuristic provider</h4>
        <div className="dim small">Always available and free: a deterministic agent that inspects schemas, runs quality checks, generates simple SQL/migrations and drives the same tool + approval pipeline. Useful for offline work, tests and cheap deterministic tasks. Switch agents to a model provider in their configuration once a key is set.</div>
      </div>

      <div className="section">
        <h4>Keyboard shortcuts</h4>
        <KV rows={[['Ctrl+K', 'Command palette / global search'], ['Ctrl+Shift+N', 'New SQL query tab'], ['Ctrl+Enter', 'Run statement under cursor (SQL editor)'], ['Ctrl+Shift+Enter', 'Run whole editor'], ['Ctrl+J / Ctrl+B / Ctrl+I', 'Toggle bottom panel / navigation / inspector'], ['Ctrl+W', 'Close tab'], ['Middle click on a tab', 'Close tab'], ['Right click a diagram table', 'Hide it']]} />
      </div>

      <button className="btn primary" onClick={() => void save()}><Save size={13} /> Save settings</button>
    </div>
  );
}
