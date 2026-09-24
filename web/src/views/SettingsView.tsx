import React, { useEffect, useState } from 'react';
import { Save, KeyRound, Cpu, ShieldCheck, Link2, Copy, ExternalLink, Github } from 'lucide-react';
import type { OAuthProviderSettings } from '../api';
import { GoogleLogo } from './AuthView';
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
    await st().refreshAuth();
  };
  const clearSecret = async (k: string) => { await api.saveSettings({ [k]: null }); await load(); await st().refreshAuth(); };
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
        <h4><ShieldCheck size={11} /> Sign-in providers</h4>
        <div className="dim small" style={{ marginBottom: 8 }}>Add Google or GitHub sign-in. Their buttons appear on the sign-in screen once a client ID and secret are saved. Environment variables, when set, take priority.</div>
        <div className="grid cols-2">
          {(['google', 'github'] as const).map((name) => (
            <OAuthProviderCard key={name} name={name} info={s.signIn[name]} publicUrl={s.signIn.publicUrl}
              clientId={values[`oauth.${name}.clientId`] ?? ''} onClientId={(v) => setValues({ ...values, [`oauth.${name}.clientId`]: v })}
              secret={secrets[`oauth.${name}.clientSecret`] ?? ''} onSecret={(v) => setSecrets({ ...secrets, [`oauth.${name}.clientSecret`]: v })}
              secretStored={!!s.secrets[`oauth.${name}.clientSecret`]} onClearSecret={() => void clearSecret(`oauth.${name}.clientSecret`)} />
          ))}
        </div>
      </div>

      <ConnectedAccounts />

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

type OAuthName = 'google' | 'github';

const OAUTH_HELP: Record<OAuthName, { label: string; consoleUrl: string; consoleName: string; steps: string; callbackField: string }> = {
  google: {
    label: 'Google', consoleUrl: 'https://console.cloud.google.com/apis/credentials', consoleName: 'Google Cloud Console',
    steps: 'Choose Create credentials, then OAuth client ID, with application type Web application.', callbackField: 'Authorized redirect URIs',
  },
  github: {
    label: 'GitHub', consoleUrl: 'https://github.com/settings/applications/new', consoleName: 'GitHub OAuth Apps',
    steps: 'Register a new OAuth app. Use the address you open SchemaForge at as the homepage URL.', callbackField: 'Authorization callback URL',
  },
};

function OAuthProviderCard(props: {
  name: OAuthName; info: OAuthProviderSettings; publicUrl: string | null;
  clientId: string; onClientId(v: string): void; secret: string; onSecret(v: string): void; secretStored: boolean; onClearSecret(): void;
}) {
  const { name, info } = props;
  const help = OAUTH_HELP[name];
  const toast = useStore((s) => s.toast);
  const callback = `${props.publicUrl ?? window.location.origin}/api/auth/${name}/callback`;
  const copy = () => { void navigator.clipboard.writeText(callback).then(() => toast('Callback URL copied', 'success')); };
  return (
    <div className="card col">
      <div className="row">
        {name === 'google' ? <GoogleLogo /> : <Github size={14} />}<strong>{help.label}</strong><span className="grow" />
        <Badge status={info.configured ? 'ok' : ''}>{info.configured ? 'enabled' : 'not configured'}</Badge>
      </div>
      <ol className="small dim" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
        <li>Open <a href={help.consoleUrl} target="_blank" rel="noreferrer">{help.consoleName} <ExternalLink size={10} /></a>. {help.steps}</li>
        <li>Add this URL under <strong>{help.callbackField}</strong>:</li>
      </ol>
      <div className="row"><code className="grow ellipsis" title={callback}>{callback}</code><button type="button" className="btn sm" onClick={copy} title="Copy"><Copy size={11} /></button></div>
      {info.fromEnv ? (
        <div className="small muted">Configured by environment variables, which take priority over this form.</div>
      ) : (
        <>
          <div className="field"><label>Client ID</label><input className="input" autoComplete="off" value={props.clientId} onChange={(e) => props.onClientId(e.target.value)} /></div>
          <div className="field">
            <label>Client secret {props.secretStored ? <span className="badge ok">stored</span> : null}</label>
            <div className="row">
              <input className="input grow" type="password" autoComplete="off" placeholder={props.secretStored ? '•••••••• (stored)' : ''} value={props.secret} onChange={(e) => props.onSecret(e.target.value)} />
              {props.secretStored && <button type="button" className="btn sm" onClick={props.onClearSecret}>clear</button>}
            </div>
          </div>
        </>
      )}
      <div className="small muted">Always open SchemaForge at this same address; the provider only returns to the exact callback URL above.</div>
    </div>
  );
}

function ConnectedAccounts() {
  const auth = useStore((s) => s.auth);
  const refreshAuth = useStore((s) => s.refreshAuth);
  const toast = useStore((s) => s.toast);
  if (!auth?.user) return null;
  const disconnect = async (provider: OAuthName) => {
    if (!window.confirm(`Disconnect ${OAUTH_HELP[provider].label}? You will no longer be able to sign in with it.`)) return;
    try {
      await api.disconnectIdentity(provider);
      await refreshAuth();
      toast(`${OAUTH_HELP[provider].label} disconnected`, 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <div className="section">
      <h4><Link2 size={11} /> Your sign-in methods</h4>
      <div className="card col">
        <div className="row small">
          <strong style={{ width: 130 }}>Email and password</strong><span className="dim">{auth.user.email}</span><span className="grow" />
          {auth.hasPassword ? <Badge status="ok">set</Badge> : <span className="muted">no password</span>}
        </div>
        {(['google', 'github'] as const).map((p) => {
          const identity = auth.identities.find((i) => i.provider === p);
          return (
            <div key={p} className="row small">
              <strong style={{ width: 130 }} className="row">{p === 'google' ? <GoogleLogo size={12} /> : <Github size={12} />} {OAUTH_HELP[p].label}</strong>
              <span className="dim">{identity ? identity.email ?? 'connected' : ''}</span><span className="grow" />
              {identity
                ? <button type="button" className="btn sm" onClick={() => void disconnect(p)}>Disconnect</button>
                : auth.providers[p]
                  ? <a className="btn sm primary" href={`/api/auth/${p}/connect`}>Connect</a>
                  : <span className="muted">configure it above first</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
