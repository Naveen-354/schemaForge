import crypto from 'node:crypto';
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AuthProvider, AuthStatus } from '@schemaforge/shared';
import {
  AuthError, assertNotThrottled, baseUrl, burnPasswordCheck, clearFailures, clientIp, createSession, destroySession, hashPassword,
  identities, isSecure, normalizeEmail, oauthConfigured, oauthCredentials, publicUser, readSession, recordFailure, registrationOpen,
  users, validatePassword, verifyPassword, type OAuthProviderName,
} from '../auth.js';

export const auth = new Hono();

const LABEL: Record<AuthProvider, string> = { local: 'email and password', google: 'Google', github: 'GitHub' };

async function body(c: Context): Promise<Record<string, unknown>> {
  return (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
}

function status(c: Context): AuthStatus {
  const user = readSession(c);
  const account = user ? users.findById(user.id) : null;
  return {
    user,
    hasUsers: users.count() > 0,
    registrationOpen: registrationOpen(),
    providers: { google: oauthConfigured('google'), github: oauthConfigured('github') },
    hasPassword: !!account?.passwordHash,
    identities: user ? identities.forUser(user.id) : [],
  };
}

/** Human description of how an existing account signs in, e.g. "your password or GitHub". */
function signInMethods(userId: string): string {
  const account = users.findById(userId);
  const methods = [...(account?.passwordHash ? ['your password'] : []), ...identities.forUser(userId).map((i) => LABEL[i.provider])];
  return methods.join(' or ') || 'your original method';
}

auth.get('/me', (c) => c.json(status(c)));

auth.post('/register', async (c) => {
  if (!registrationOpen()) throw new AuthError('Registration is closed. Sign in with the existing account, or start the server with SCHEMAFORGE_ALLOW_REGISTRATION=true.', 403);
  const b = await body(c);
  const email = normalizeEmail(b.email);
  const password = validatePassword(b.password);
  if (users.findByEmail(email)) throw new AuthError('An account with this email already exists. Sign in instead.', 409);
  const user = users.create({ email, passwordHash: await hashPassword(password), provider: 'local' });
  createSession(c, user.id);
  console.log(`[auth] registered ${email}`);
  return c.json({ user }, 201);
});

auth.post('/login', async (c) => {
  const b = await body(c);
  const email = normalizeEmail(b.email);
  const password = typeof b.password === 'string' ? b.password : '';
  if (!password) throw new AuthError('Enter your password.');
  const ip = clientIp(c);
  assertNotThrottled(ip, email);
  const user = users.findByEmail(email);
  if (user && !user.passwordHash) throw new AuthError(`This account has no password. Sign in with ${signInMethods(user.id)}.`, 401);
  const ok = user ? await verifyPassword(password, user.passwordHash) : await burnPasswordCheck(password);
  if (!user || !ok) {
    recordFailure(ip, email);
    throw new AuthError('Incorrect email or password.', 401);
  }
  clearFailures(email);
  createSession(c, user.id);
  return c.json({ user: publicUser(user) });
});

auth.post('/logout', (c) => {
  destroySession(c);
  return c.json({ ok: true });
});

/** Remove a linked Google or GitHub account, unless it is the only way left to sign in. */
auth.delete('/identities/:provider', (c) => {
  const user = readSession(c);
  if (!user) return c.json({ error: 'Sign in required' }, 401);
  const name = c.req.param('provider');
  if (name !== 'google' && name !== 'github') return c.json({ error: 'Unknown sign-in provider' }, 404);
  const account = users.findById(user.id);
  const others = identities.forUser(user.id).filter((i) => i.provider !== name);
  if (!account?.passwordHash && others.length === 0) throw new AuthError(`${LABEL[name]} is your only way to sign in, so it cannot be disconnected.`);
  if (!identities.unlink(user.id, name)) throw new AuthError(`${LABEL[name]} is not connected.`, 404);
  return c.json(status(c));
});

// ---------- OAuth (Google, GitHub) ----------

interface OAuthProfile { id: string; email: string | null; verified: boolean }
interface OAuthProvider {
  authorizeUrl(clientId: string, state: string, redirectUri: string): string;
  profile(creds: { clientId: string; clientSecret: string }, code: string, redirectUri: string): Promise<OAuthProfile>;
}

async function getJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return (await res.json()) as T;
}

const oauth: Record<OAuthProviderName, OAuthProvider> = {
  google: {
    authorizeUrl: (clientId, state, redirectUri) => `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account',
    })}`,
    async profile(creds, code, redirectUri) {
      const token = await getJson<{ access_token?: string }>('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: creds.clientId, client_secret: creds.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
      });
      if (!token.access_token) throw new Error('no access token');
      const u = await getJson<{ id: string; email?: string; verified_email?: boolean }>('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { authorization: `Bearer ${token.access_token}` } });
      return { id: String(u.id), email: u.email ?? null, verified: !!u.verified_email };
    },
  },
  github: {
    authorizeUrl: (clientId, state, redirectUri) => `https://github.com/login/oauth/authorize?${new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, scope: 'read:user user:email', state, allow_signup: 'false',
    })}`,
    async profile(creds, code, redirectUri) {
      const token = await getJson<{ access_token?: string }>('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ client_id: creds.clientId, client_secret: creds.clientSecret, code, redirect_uri: redirectUri }),
      });
      if (!token.access_token) throw new Error('no access token');
      const headers = { authorization: `Bearer ${token.access_token}`, accept: 'application/vnd.github+json', 'user-agent': 'SchemaForge' };
      const u = await getJson<{ id: number }>('https://api.github.com/user', { headers });
      const emails = await getJson<{ email: string; primary: boolean; verified: boolean }[]>('https://api.github.com/user/emails', { headers });
      const best = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
      return { id: String(u.id), email: best?.email ?? null, verified: !!best };
    },
  },
};

type OAuthMode = 'login' | 'connect';
const STATE_COOKIE = 'sf_oauth_state';

function redirectUri(c: Context, provider: OAuthProviderName): string {
  return `${baseUrl(c)}/api/auth/${provider}/callback`;
}

function back(c: Context, kind: 'auth_error' | 'auth_notice', message: string) {
  deleteCookie(c, STATE_COOKIE, { path: '/api/auth' });
  return c.redirect(`/?${kind}=${encodeURIComponent(message)}`);
}

function providerName(c: Context): OAuthProviderName | null {
  const name = c.req.param('provider');
  return name === 'google' || name === 'github' ? name : null;
}

function start(c: Context, mode: OAuthMode) {
  const name = providerName(c);
  if (!name) return c.json({ error: 'Unknown sign-in provider' }, 404);
  if (!oauthConfigured(name)) return back(c, 'auth_error', `${LABEL[name]} sign-in is not configured on this server. Add its client ID and secret in Settings.`);
  if (mode === 'connect' && !readSession(c)) return back(c, 'auth_error', `Sign in before connecting ${LABEL[name]}.`);
  const state = crypto.randomBytes(24).toString('base64url');
  setCookie(c, STATE_COOKIE, `${name}.${mode}.${state}`, { path: '/api/auth', httpOnly: true, sameSite: 'Lax', secure: isSecure(c), maxAge: 600 });
  return c.redirect(oauth[name].authorizeUrl(oauthCredentials(name).clientId, state, redirectUri(c, name)));
}

auth.get('/:provider/login', (c) => start(c, 'login'));
auth.get('/:provider/connect', (c) => start(c, 'connect'));

auth.get('/:provider/callback', async (c) => {
  const name = providerName(c);
  if (!name) return c.json({ error: 'Unknown sign-in provider' }, 404);
  const label = LABEL[name];

  // CSRF protection: the state returned by the provider must match the one issued to this browser.
  const [cookieProvider, cookieMode, cookieState = ''] = (getCookie(c, STATE_COOKIE) ?? '').split('.');
  const expected = Buffer.from(cookieState);
  const received = Buffer.from(c.req.query('state') ?? '');
  const validMode = cookieMode === 'login' || cookieMode === 'connect';
  if (cookieProvider !== name || !validMode || !expected.length || expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return back(c, 'auth_error', `${label} sign-in expired or was not started from this browser. Try again.`);
  }
  const mode = cookieMode as OAuthMode;
  deleteCookie(c, STATE_COOKIE, { path: '/api/auth' });
  if (c.req.query('error')) return back(c, 'auth_error', `${label} sign-in was cancelled.`);
  const code = c.req.query('code');
  if (!code || !oauthConfigured(name)) return back(c, 'auth_error', `${label} sign-in failed.`);

  let profile: OAuthProfile;
  try {
    profile = await oauth[name].profile(oauthCredentials(name), code, redirectUri(c, name));
  } catch (e) {
    console.error(`[auth] ${name} sign-in failed: ${(e as Error).message}`);
    return back(c, 'auth_error', `${label} sign-in failed. Check that the client ID, secret and callback URL match, and see the server log.`);
  }
  const email = profile.email ? profile.email.trim().toLowerCase() : null;

  if (mode === 'connect') {
    const current = readSession(c);
    if (!current) return back(c, 'auth_error', `Sign in before connecting ${label}.`);
    const linked = identities.find(name, profile.id);
    if (linked && linked.userId !== current.id) return back(c, 'auth_error', `This ${label} account is already connected to a different SchemaForge account.`);
    if (linked) return back(c, 'auth_notice', `${label} is already connected.`);
    if (identities.forUser(current.id).some((i) => i.provider === name)) return back(c, 'auth_error', `Another ${label} account is already connected. Disconnect it first.`);
    identities.link(current.id, name, profile.id, email);
    console.log(`[auth] ${current.email} connected ${name}`);
    return back(c, 'auth_notice', `${label} connected. You can now sign in with ${label}.`);
  }

  // Sign in: an already-linked identity always wins; otherwise only create a brand-new account.
  const linked = identities.find(name, profile.id);
  if (linked) {
    createSession(c, linked.userId);
    return c.redirect('/');
  }
  if (!email || !profile.verified) return back(c, 'auth_error', `Your ${label} account has no verified email address.`);
  const existing = users.findByEmail(email);
  if (existing) {
    // Never merge accounts by email alone: the owner must prove access to both by connecting from Settings.
    return back(c, 'auth_error', `An account for ${email} already exists. Sign in with ${signInMethods(existing.id)}, then connect ${label} in Settings.`);
  }
  if (!registrationOpen()) return back(c, 'auth_error', 'Registration is closed on this server.');
  const user = users.create({ email, passwordHash: null, provider: name, providerId: profile.id });
  identities.link(user.id, name, profile.id, email);
  console.log(`[auth] registered ${email} via ${name}`);
  createSession(c, user.id);
  return c.redirect('/');
});
