import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..');

export const config = {
  port: Number(process.env.PORT ?? 4310),
  host: process.env.HOST ?? '127.0.0.1',
  dataDir: path.resolve(process.env.SCHEMAFORGE_DATA_DIR ?? path.join(repoRoot, 'data')),
  webDist: path.join(repoRoot, 'web', 'dist'),
  version: '0.1.0',
  /** Hard cap on rows returned by any SQL execution. */
  maxRows: Number(process.env.SCHEMAFORGE_MAX_ROWS ?? 1000),
  queryTimeoutMs: Number(process.env.SCHEMAFORGE_QUERY_TIMEOUT_MS ?? 30_000),
  /** Max concurrently running agents. */
  maxConcurrentRuns: Number(process.env.SCHEMAFORGE_MAX_CONCURRENT_RUNS ?? 4),
};

fs.mkdirSync(config.dataDir, { recursive: true });
