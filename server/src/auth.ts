import crypto from 'node:crypto';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { AuthIdentity, AuthProvider, AuthUser } from '@schemaforge/shared';
import { config } from './config.js';
import { getDb, newId, now, type Row } from './store/db.js';
import { settings } from './store/repos.js';

export type AuthEnv = { Variables: { user: AuthUser } };

export class AuthError extends Error {
  constructor(message: string, public readonly status: 400 | 401 | 403 | 404 | 409 | 429 = 400) {
    super(message);
  }
}

// ---------- validation ----------

export const PASSWORD_MIN = 8;
const PASSWORD_MAX = 256;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: unknown): string {
  const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!e || e.length > 254 || !EMAIL_RE.test(e)) throw new AuthError('Enter a valid email address.');
  return e;
}

export function validatePassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) throw new AuthError(`Password must be at least ${PASSWORD_MIN} characters.`);
  if (password.length > PASSWORD_MAX) throw new AuthError(`Password must be at most ${PASSWORD_MAX} characters.`);
  return password;
}

// ---------- password hashing (scrypt, constant-time compare) ----------

const KEY_LEN = 64;

function scrypt(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, KEY_LEN, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt:${salt}:${(await scrypt(password, salt)).toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [scheme, salt, hex] = (stored ?? '').split(':');
  if (scheme !== 'scrypt' || !salt || !hex) return false;
  const expected = Buffer.from(hex, 'hex');
  const actual = await scrypt(password, salt);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** Hash used to spend the same time when an account does not exist, so response timing does not reveal it. */
let dummyHash: Promise<string> | null = null;
export function burnPasswordCheck(password: string): Promise<boolean> {
  dummyHash ??= hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummyHash.then((h) => verifyPassword(password, h));
}

// ---------- users ----------

interface UserRecord extends AuthUser {
  passwordHash: string | null;
  providerId: string | null;
}

function mapUser(r: Row): UserRecord {
  return {
    id: String(r.id), email: String(r.email), provider: r.provider as AuthProvider, createdAt: String(r.created_at),
    passwordHash: (r.password_hash as string | null) ?? null, providerId: (r.provider_id as string | null) ?? null,
  };
}

export function publicUser(u: UserRecord | AuthUser): AuthUser {
  return { id: u.id, email: u.email, provider: u.provider, createdAt: u.createdAt };
}

export const users = {
  count(): number {
    return Number((getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as Row).n);
  },
  list(): AuthUser[] {
    return getDb().prepare('SELECT * FROM users ORDER BY created_at').all().map((r) => publicUser(mapUser(r)));
  },
  findByEmail(email: string): UserRecord | null {
    const r = getDb().prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email);
    return r ? mapUser(r) : null;
  },
  findById(id: string): UserRecord | null {
    const r = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
    return r ? mapUser(r) : null;
  },
  create(input: { email: string; passwordHash: string | null; provider: AuthProvider; providerId?: string | null }): AuthUser {
    const id = newId();
    const t = now();
    getDb().prepare('INSERT INTO users (id, email, password_hash, provider, provider_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, input.email, input.passwordHash, input.provider, input.providerId ?? null, t, t);
    return { id, email: input.email, provider: input.provider, createdAt: t };
  },
  setPassword(id: string, passwordHash: string): void {
    getDb().prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now(), id);
  },
};

// ---------- external sign-in identities (Google, GitHub) linked to an account ----------

export type OAuthProviderName = 'google' | 'github';

export const identities = {
  find(provider: OAuthProviderName, providerId: string): { userId: string } | null {
    const r = getDb().prepare('SELECT user_id FROM user_identities WHERE provider = ? AND provider_id = ?').get(provider, providerId);
    return r ? { userId: String(r.user_id) } : null;
  },
  forUser(userId: string): AuthIdentity[] {
    return getDb().prepare('SELECT provider, email, created_at FROM user_identities WHERE user_id = ? ORDER BY created_at').all(userId)
      .map((r) => ({ provider: r.provider as OAuthProviderName, email: (r.email as string | null) ?? null, createdAt: String(r.created_at) }));
  },
  link(userId: string, provider: OAuthProviderName, providerId: string, email: string | null): void {
    getDb().prepare('INSERT INTO user_identities (provider, provider_id, user_id, email, created_at) VALUES (?,?,?,?,?)').run(provider, providerId, userId, email, now());
  },
  unlink(userId: string, provider: OAuthProviderName): boolean {
    return Number(getDb().prepare('DELETE FROM user_identities WHERE user_id = ? AND provider = ?').run(userId, provider).changes) > 0;
  },
};

/** OAuth app credentials: environment variables win, otherwise the values saved in Settings. */
export function oauthCredentials(name: OAuthProviderName): { clientId: string; clientSecret: string; fromEnv: boolean } {
  const envId = name === 'google' ? config.googleClientId : config.githubClientId;
  const envSecret = name === 'google' ? config.googleClientSecret : config.githubClientSecret;
  if (envId && envSecret) return { clientId: envId, clientSecret: envSecret, fromEnv: true };
  return { clientId: settings.get(`oauth.${name}.clientId`) ?? '', clientSecret: settings.getSecret(`oauth.${name}.clientSecret`) ?? '', fromEnv: false };
}

export function oauthConfigured(name: OAuthProviderName): boolean {
  const c = oauthCredentials(name);
  return !!(c.clientId && c.clientSecret);
}

/** A personal instance: the first account may always register; later ones only when explicitly allowed. */
export function registrationOpen(): boolean {
  return config.allowRegistration || users.count() === 0;
}

// ---------- sessions (opaque random token in an httpOnly cookie; only its hash is stored) ----------

export const SESSION_COOKIE = 'sf_session';
const DAY_MS = 86_400_000;
const ttlMs = () => config.sessionTtlDays * DAY_MS;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** PUBLIC_URL when set, otherwise the origin the browser used for this request. */
export function baseUrl(c: Context): string {
  return config.publicUrl ?? new URL(c.req.url).origin;
}

export function isSecure(c: Context): boolean {
  return baseUrl(c).startsWith('https://');
}

function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'Lax', secure: isSecure(c), maxAge: Math.floor(ttlMs() / 1000) });
}

export function clientIp(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function createSession(c: Context, userId: string): void {
  const token = crypto.randomBytes(32).toString('base64url');
  const t = Date.now();
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date(t).toISOString());
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent, ip) VALUES (?,?,?,?,?,?,?)').run(
    hashToken(token), userId, new Date(t).toISOString(), new Date(t + ttlMs()).toISOString(), new Date(t).toISOString(),
    (c.req.header('user-agent') ?? '').slice(0, 300), clientIp(c),
  );
  setSessionCookie(c, token);
}

/** Resolve the signed-in user from the session cookie, extending the session at most once a day. */
export function readSession(c: Context): AuthUser | null {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const db = getDb();
  const id = hashToken(token);
  const row = db.prepare('SELECT s.expires_at AS s_expires, s.last_seen_at AS s_seen, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?').get(id);
  const t = Date.now();
  if (!row || Date.parse(String(row.s_expires)) <= t) {
    if (row) db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return null;
  }
  if (t - Date.parse(String(row.s_seen)) > DAY_MS) {
    db.prepare('UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?').run(new Date(t + ttlMs()).toISOString(), new Date(t).toISOString(), id);
    setSessionCookie(c, token);
  }
  return publicUser(mapUser(row));
}

export function destroySession(c: Context): void {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) getDb().prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export function destroyUserSessions(userId: string): void {
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

// ---------- failed-login throttling (in memory; resets on restart) ----------

const WINDOW_MS = 15 * 60_000;
const LIMITS = { email: 10, ip: 50 };
const failures = new Map<string, number[]>();

function recent(key: string): number[] {
  const t = Date.now();
  const list = (failures.get(key) ?? []).filter((x) => t - x < WINDOW_MS);
  if (list.length) failures.set(key, list);
  else failures.delete(key);
  return list;
}

export function assertNotThrottled(ip: string, email: string): void {
  if (recent(`email:${email}`).length >= LIMITS.email || recent(`ip:${ip}`).length >= LIMITS.ip) {
    throw new AuthError('Too many failed sign-in attempts. Try again in 15 minutes.', 429);
  }
}

export function recordFailure(ip: string, email: string): void {
  const t = Date.now();
  for (const key of [`email:${email}`, `ip:${ip}`]) failures.set(key, [...recent(key), t]);
}

export function clearFailures(email: string): void {
  failures.delete(`email:${email}`);
}

// ---------- middleware ----------

const PUBLIC_PATHS = new Set(['/api/health']);

/** Every API route requires a session except health and the auth routes themselves. */
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const path = c.req.path;
  if (c.req.method === 'OPTIONS' || PUBLIC_PATHS.has(path) || path.startsWith('/api/auth/')) return next();
  const user = readSession(c);
  if (!user) return c.json({ error: 'Sign in required' }, 401);
  c.set('user', user);
  await next();
});
