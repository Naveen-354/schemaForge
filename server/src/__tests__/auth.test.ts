import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.SCHEMAFORGE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-auth-'));
delete process.env.SCHEMAFORGE_ALLOW_REGISTRATION;

const { openMemoryDb, getDb } = await import('../store/db.js');
openMemoryDb();
const { createApp } = await import('../app.js');
const app = createApp();

async function call(method: string, url: string, opts: { body?: unknown; cookie?: string; origin?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.origin) headers.origin = opts.origin;
  return app.request(url, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
}

function sessionCookie(res: Response): string {
  const m = /sf_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '');
  return m ? `sf_session=${m[1]}` : '';
}

const OWNER = { email: 'Owner@Example.com', password: 'correct-horse-battery' };
let ownerCookie = '';

test('fresh install reports no users and open registration', async () => {
  const res = await call('GET', '/api/auth/me');
  const body = await res.json() as any;
  assert.equal(body.user, null);
  assert.equal(body.hasUsers, false);
  assert.equal(body.registrationOpen, true);
  assert.deepEqual(body.providers, { google: false, github: false });
});

test('API routes require a session; health does not', async () => {
  assert.equal((await call('GET', '/api/projects')).status, 401);
  assert.equal((await call('GET', '/api/events/stream')).status, 401);
  assert.equal((await call('POST', '/api/sql/execute', { body: { connectionId: 'x', sql: 'DROP TABLE t' } })).status, 401);
  assert.equal((await call('GET', '/api/health')).status, 200);
});

test('registration validates email and password', async () => {
  assert.equal((await call('POST', '/api/auth/register', { body: { email: 'not-an-email', password: 'longenough' } })).status, 400);
  const short = await call('POST', '/api/auth/register', { body: { email: 'a@b.co', password: 'short' } });
  assert.equal(short.status, 400);
  assert.match((await short.json() as any).error, /at least 8/);
});

test('first registration creates the owner and signs in', async () => {
  const res = await call('POST', '/api/auth/register', { body: OWNER });
  assert.equal(res.status, 201);
  const { user } = await res.json() as any;
  assert.equal(user.email, 'owner@example.com', 'email is normalized');
  assert.equal(user.provider, 'local');
  ownerCookie = sessionCookie(res);
  assert.ok(ownerCookie, 'session cookie set');
  assert.match(res.headers.get('set-cookie') ?? '', /HttpOnly/i);
  assert.match(res.headers.get('set-cookie') ?? '', /SameSite=Lax/i);

  const me = await (await call('GET', '/api/auth/me', { cookie: ownerCookie })).json() as any;
  assert.equal(me.user.email, 'owner@example.com');
  assert.equal((await call('GET', '/api/projects', { cookie: ownerCookie })).status, 200);
});

test('passwords and session tokens are never stored in plain text', () => {
  const row = getDb().prepare('SELECT password_hash FROM users').get() as { password_hash: string };
  assert.match(row.password_hash, /^scrypt:/);
  assert.ok(!row.password_hash.includes(OWNER.password));
  const token = ownerCookie.split('=')[1];
  const sessions = getDb().prepare('SELECT id FROM sessions').all() as { id: string }[];
  assert.ok(sessions.length > 0 && sessions.every((s) => s.id !== token));
});

test('registration closes after the owner account exists', async () => {
  const status = await (await call('GET', '/api/auth/me')).json() as any;
  assert.equal(status.registrationOpen, false);
  const res = await call('POST', '/api/auth/register', { body: { email: 'intruder@example.com', password: 'longenough1' } });
  assert.equal(res.status, 403);
});

test('login rejects a wrong password and accepts the right one', async () => {
  const bad = await call('POST', '/api/auth/login', { body: { email: OWNER.email, password: 'wrong-password' } });
  assert.equal(bad.status, 401);
  assert.equal(sessionCookie(bad), '');
  const unknown = await call('POST', '/api/auth/login', { body: { email: 'nobody@example.com', password: 'whatever12' } });
  assert.equal(unknown.status, 401);
  assert.equal((await bad.json() as any).error, (await unknown.json() as any).error, 'same message for unknown email and wrong password');

  const ok = await call('POST', '/api/auth/login', { body: { email: 'OWNER@example.com ', password: OWNER.password } });
  assert.equal(ok.status, 200);
  assert.ok(sessionCookie(ok));
});

test('logout revokes the session on the server', async () => {
  const login = await call('POST', '/api/auth/login', { body: OWNER });
  const cookie = sessionCookie(login);
  assert.equal((await call('GET', '/api/projects', { cookie })).status, 200);
  const out = await call('POST', '/api/auth/logout', { cookie });
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie') ?? '', /sf_session=;/);
  // Reusing the old cookie must fail even though the browser was only told to delete it.
  assert.equal((await call('GET', '/api/projects', { cookie })).status, 401);
  assert.equal((await (await call('GET', '/api/auth/me', { cookie })).json() as any).user, null);
  // Other sessions of the same user stay valid.
  assert.equal((await call('GET', '/api/projects', { cookie: ownerCookie })).status, 200);
});

test('expired sessions are rejected and removed', async () => {
  const login = await call('POST', '/api/auth/login', { body: OWNER });
  const cookie = sessionCookie(login);
  getDb().prepare('UPDATE sessions SET expires_at = ? WHERE id NOT IN (SELECT id FROM sessions ORDER BY created_at LIMIT 1)').run('2000-01-01T00:00:00.000Z');
  assert.equal((await call('GET', '/api/projects', { cookie })).status, 401);
});

test('CORS only allows the app origins', async () => {
  const evil = await call('GET', '/api/health', { origin: 'https://evil.example' });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const dev = await call('GET', '/api/health', { origin: 'http://localhost:5173' });
  assert.equal(dev.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(dev.headers.get('access-control-allow-credentials'), 'true');
});

test('OAuth refuses unconfigured providers and mismatched state', async () => {
  const login = await call('GET', '/api/auth/google/login');
  assert.equal(login.status, 302);
  assert.match(login.headers.get('location') ?? '', /auth_error=.*not%20configured/);
  const cb = await call('GET', '/api/auth/github/callback?code=abc&state=forged', { cookie: 'sf_oauth_state=github.real-state' });
  assert.equal(cb.status, 302);
  assert.match(cb.headers.get('location') ?? '', /auth_error=/);
  assert.equal(sessionCookie(cb), '');
  assert.equal((await call('GET', '/api/auth/nope/login')).status, 404);
});

test('repeated failed logins are throttled', async () => {
  const email = 'owner@example.com';
  let last = 0;
  for (let i = 0; i < 11; i++) last = (await call('POST', '/api/auth/login', { body: { email, password: `wrong-${i}-password` } })).status;
  assert.equal(last, 429);
  // Even the right password is refused while throttled.
  assert.equal((await call('POST', '/api/auth/login', { body: OWNER })).status, 429);
});
