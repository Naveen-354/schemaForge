import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..');

const port = Number(process.env.PORT ?? 4310);
const host = process.env.HOST ?? '127.0.0.1';
/** Explicit public URL. When unset, OAuth callbacks use the origin the browser actually used. */
const publicUrl: string | null = process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/+$/, '') : null;

export const config = {
  port,
  host,
  dataDir: path.resolve(process.env.SCHEMAFORGE_DATA_DIR ?? path.join(repoRoot, 'data')),
  webDist: path.join(repoRoot, 'web', 'dist'),
  version: '0.1.0',
  /** Hard cap on rows returned by any SQL execution. */
  maxRows: Number(process.env.SCHEMAFORGE_MAX_ROWS ?? 1000),
  queryTimeoutMs: Number(process.env.SCHEMAFORGE_QUERY_TIMEOUT_MS ?? 30_000),
  /** Max concurrently running agents. */
  maxConcurrentRuns: Number(process.env.SCHEMAFORGE_MAX_CONCURRENT_RUNS ?? 4),
  publicUrl,
  /** Browser origins allowed to call the API cross-origin (the Vite dev server by default). */
  allowedOrigins: [
    ...new Set([
      ...(publicUrl ? [new URL(publicUrl).origin] : []),
      `http://localhost:${port}`, `http://127.0.0.1:${port}`,
      'http://localhost:5173', 'http://127.0.0.1:5173',
      ...(process.env.SCHEMAFORGE_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    ]),
  ],
  /** When false, only the very first account can be registered. */
  allowRegistration: /^(1|true|yes)$/i.test(process.env.SCHEMAFORGE_ALLOW_REGISTRATION ?? ''),
  /** Sessions expire after this many days without activity. */
  sessionTtlDays: Number(process.env.SCHEMAFORGE_SESSION_DAYS ?? 7),
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  githubClientId: process.env.GITHUB_CLIENT_ID ?? '',
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
};

fs.mkdirSync(config.dataDir, { recursive: true });
