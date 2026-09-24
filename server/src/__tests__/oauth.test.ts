import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.SCHEMAFORGE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-oauth-'));
delete process.env.SCHEMAFORGE_ALLOW_REGISTRATION;
for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'PUBLIC_URL']) delete process.env[k];

const { openMemoryDb } = await import('../store/db.js');
openMemoryDb();
const { settings } = await import('../store/repos.js');
const { users, hashPassword } = await import('../auth.js');
const { createApp } = await import('../app.js');
const app = createApp();

// Simulated Google and GitHub: only their HTTPS endpoints are intercepted.
let googleUser: { id: string; email: string; verified_email: boolean } = { id: 'g-1', email: 'owner@example.com', verified_email: true };
let githubUser = { id: 42, emails: [{ email: 'dev@example.com', primary: true, verified: true }] };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'g-token' });
  if (url.startsWith('https://www.googleapis.com/oauth2/v2/userinfo')) return Response.json(googleUser);
  if (url.startsWith('https://github.com/login/oauth/access_token')) return Response.json({ access_token: 'gh-token' });
  if (url === 'https://api.github.com/user') return Response.json({ id: githubUser.id });
  if (url === 'https://api.github.com/user/emails') return Response.json(githubUser.emails);
  return realFetch(input as never, init);
}) as typeof fetch;

async function call(method: string, url: string, cookie = '', body?: unknown) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return app.request(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

function sessionCookie(res: Response): string {
  const m = /sf_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '');
  return m ? `sf_session=${m[1]}` : '';
}

/** Run a full browser round trip: start at SchemaForge, "return" from the provider, land on the callback. */
async function flow(provider: 'google' | 'github', mode: 'login' | 'connect', session = '') {
  const start = await call('GET', `/api/auth/${provider}/${mode}`, session);
  assert.equal(start.status, 302);
  const location = start.headers.get('location') ?? '';
  if (location.startsWith('/')) return { location, cookie: '' };
  const authorize = new URL(location);
  assert.equal(authorize.searchParams.get('redirect_uri'), `http://localhost/api/auth/${provider}/callback`, 'callback built from the browser origin');
  const state = authorize.searchParams.get('state') ?? '';
  const stateCookie = /sf_oauth_state=([^;]+)/.exec(start.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const cb = await call('GET', `/api/auth/${provider}/callback?code=test-code&state=${encodeURIComponent(state)}`, [`sf_oauth_state=${stateCookie}`, session].filter(Boolean).join('; '));
  assert.equal(cb.status, 302);
  return { location: cb.headers.get('location') ?? '', cookie: sessionCookie(cb) };
}

const me = async (cookie: string) => (await (await call('GET', '/api/auth/me', cookie)).json()) as any;
let devCookie = '';
let ownerCookie = '';

test('providers turn on when credentials are saved in Settings', async () => {
  assert.deepEqual((await me('')).providers, { google: false, github: false });
  settings.set('oauth.github.clientId', 'gh-client');
  settings.setSecret('oauth.github.clientSecret', 'gh-secret');
  settings.set('oauth.google.clientId', 'g-client');
  settings.setSecret('oauth.google.clientSecret', 'g-secret');
  assert.deepEqual((await me('')).providers, { google: true, github: true });
  assert.notEqual(settings.get('oauth.github.clientSecret'), 'gh-secret', 'client secret is encrypted at rest');
});

test('first GitHub sign-in creates the owner account', async () => {
  const r = await flow('github', 'login');
  assert.equal(r.location, '/');
  assert.ok(r.cookie);
  devCookie = r.cookie;
  const status = await me(devCookie);
  assert.equal(status.user.email, 'dev@example.com');
  assert.equal(status.user.provider, 'github');
  assert.equal(status.hasPassword, false);
  assert.deepEqual(status.identities.map((i: { provider: string }) => i.provider), ['github']);
  // Signing in again finds the same account through the linked identity.
  const again = await flow('github', 'login');
  assert.equal((await me(again.cookie)).user.id, status.user.id);
});

test('password login on a password-less account says how to sign in', async () => {
  const res = await call('POST', '/api/auth/login', '', { email: 'dev@example.com', password: 'anything-123' });
  assert.equal(res.status, 401);
  assert.match(((await res.json()) as any).error, /GitHub/);
});

test('new external accounts are refused once registration is closed', async () => {
  const saved = githubUser;
  githubUser = { id: 43, emails: [{ email: 'stranger@example.com', primary: true, verified: true }] };
  const r = await flow('github', 'login');
  githubUser = saved;
  assert.match(decodeURIComponent(r.location), /auth_error=Registration is closed/);
  assert.equal(r.cookie, '');
});

test('unverified emails are refused', async () => {
  const saved = googleUser;
  googleUser = { id: 'g-9', email: 'unverified@example.com', verified_email: false };
  const r = await flow('google', 'login');
  googleUser = saved;
  assert.match(decodeURIComponent(r.location), /no verified email/);
  assert.equal(r.cookie, '');
});

test('Google sign-in never merges into an existing account by email', async () => {
  users.create({ email: 'owner@example.com', passwordHash: await hashPassword('owner-password-1'), provider: 'local' });
  const r = await flow('google', 'login');
  assert.match(decodeURIComponent(r.location), /already exists\. Sign in with your password, then connect Google in Settings/);
  assert.equal(r.cookie, '');
});

test('connecting requires being signed in', async () => {
  const r = await flow('google', 'connect');
  assert.match(decodeURIComponent(r.location), /Sign in before connecting Google/);
});

test('a signed-in user can connect Google and then sign in with it', async () => {
  const login = await call('POST', '/api/auth/login', '', { email: 'owner@example.com', password: 'owner-password-1' });
  ownerCookie = sessionCookie(login);
  const connected = await flow('google', 'connect', ownerCookie);
  assert.match(decodeURIComponent(connected.location), /auth_notice=Google connected/);
  const status = await me(ownerCookie);
  assert.deepEqual(status.identities.map((i: { provider: string }) => i.provider), ['google']);
  assert.equal(status.hasPassword, true);

  const viaGoogle = await flow('google', 'login');
  assert.equal(viaGoogle.location, '/');
  assert.equal((await me(viaGoogle.cookie)).user.email, 'owner@example.com');
});

test('one external account cannot be connected to two users', async () => {
  const r = await flow('google', 'connect', devCookie);
  assert.match(decodeURIComponent(r.location), /already connected to a different SchemaForge account/);
  assert.deepEqual((await me(devCookie)).identities.map((i: { provider: string }) => i.provider), ['github']);
});

test('disconnecting never removes the last way to sign in', async () => {
  const onlyMethod = await call('DELETE', '/api/auth/identities/github', devCookie);
  assert.equal(onlyMethod.status, 400);
  assert.match(((await onlyMethod.json()) as any).error, /only way to sign in/);

  const ok = await call('DELETE', '/api/auth/identities/google', ownerCookie);
  assert.equal(ok.status, 200);
  assert.deepEqual(((await ok.json()) as any).identities, []);
  assert.equal((await call('DELETE', '/api/auth/identities/google', ownerCookie)).status, 404);
  assert.equal((await call('DELETE', '/api/auth/identities/google')).status, 401);
});
