import React, { useEffect, useState } from 'react';
import { Database, Eye, EyeOff, LogIn, UserPlus, Loader2, Github } from 'lucide-react';
import { useStore } from '../store';

const MIN_PASSWORD = 8;

export function GoogleLogo({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function takeAuthErrorFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const err = params.get('auth_error');
  if (err) {
    params.delete('auth_error');
    const qs = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
  }
  return err;
}

export function AuthView() {
  const auth = useStore((s) => s.auth);
  const login = useStore((s) => s.login);
  const register = useStore((s) => s.register);
  const firstRun = !!auth && !auth.hasUsers;
  const canRegister = !!auth?.registrationOpen;

  const [mode, setMode] = useState<'login' | 'register'>(firstRun ? 'register' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(takeAuthErrorFromUrl);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (firstRun) setMode('register');
    else if (!canRegister) setMode('login');
  }, [firstRun, canRegister]);

  const switchMode = (m: 'login' | 'register') => {
    setMode(m);
    setError(null);
    setConfirm('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'register') {
      if (password.length < MIN_PASSWORD) return setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      if (password !== confirm) return setError('Passwords do not match.');
    }
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password);
    } catch (err) {
      setError((err as Error).message || 'Something went wrong. Try again.');
      setBusy(false);
    }
  };

  const title = firstRun ? 'Create the owner account' : mode === 'login' ? 'Sign in' : 'Create an account';
  const subtitle = firstRun
    ? 'This is the first start. The account you create here owns this SchemaForge instance; registration closes after it.'
    : mode === 'login' ? 'Sign in to your database engineering workspace.' : 'Create an account for this SchemaForge instance.';
  const oauth = auth?.providers;
  const showOauth = !!oauth && (oauth.google || oauth.github) && (mode === 'login' || canRegister);

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={(e) => void submit(e)} noValidate>
        <div className="auth-brand"><Database size={18} /> SchemaForge</div>
        <h1>{title}</h1>
        <p className="dim auth-sub">{subtitle}</p>

        <div className="field">
          <label htmlFor="auth-email">Email</label>
          <input id="auth-email" className="input" type="email" autoComplete="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div className="field">
          <label htmlFor="auth-password">Password</label>
          <div className="auth-password">
            <input id="auth-password" className="input" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required
              value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'register' ? `At least ${MIN_PASSWORD} characters` : ''} />
            <button type="button" className="btn ghost sm icon" onClick={() => setShowPassword(!showPassword)} title={showPassword ? 'Hide password' : 'Show password'} aria-label={showPassword ? 'Hide password' : 'Show password'}>
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
        {mode === 'register' && (
          <div className="field">
            <label htmlFor="auth-confirm">Confirm password</label>
            <input id="auth-confirm" className="input" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
        )}

        {error && <div className="auth-error" role="alert">{error}</div>}

        <button type="submit" className="btn primary block" disabled={busy || !email || !password}>
          {busy ? <Loader2 size={14} className="spin" /> : mode === 'login' ? <LogIn size={14} /> : <UserPlus size={14} />}
          {busy ? (mode === 'login' ? 'Signing in…' : 'Creating account…') : mode === 'login' ? 'Sign in' : firstRun ? 'Create owner account' : 'Create account'}
        </button>

        {!firstRun && (
          <div className="auth-switch small">
            {mode === 'login'
              ? canRegister ? <>No account yet? <a onClick={() => switchMode('register')}>Create one</a></> : <span className="muted">Forgot your password? Run <code>npm run user -- reset-password</code> on the server.</span>
              : <>Already have an account? <a onClick={() => switchMode('login')}>Sign in</a></>}
          </div>
        )}

        {showOauth && (
          <>
            <div className="auth-divider"><span>or continue with</span></div>
            <div className="row">
              {oauth!.google && <a className="btn block" href="/api/auth/google/login"><GoogleLogo /> Google</a>}
              {oauth!.github && <a className="btn block" href="/api/auth/github/login"><Github size={14} /> GitHub</a>}
            </div>
          </>
        )}
      </form>
    </div>
  );
}
