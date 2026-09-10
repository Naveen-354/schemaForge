import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from './config.js';
import { openDb } from './store/db.js';
import { seedIfEmpty } from './seed.js';
import { runtime } from './agents/runtime.js';
import { closeAll } from './dbs/manager.js';
import { core } from './routes/core.js';
import { agentRoutes } from './routes/agents.js';
import { system } from './routes/system.js';

openDb();
seedIfEmpty();
runtime.init();

const app = new Hono();
app.use('/api/*', cors({ origin: (o) => o }));
app.onError((err, c) => {
  const status = (err as { status?: number }).status;
  const code = typeof status === 'number' && status >= 400 && status < 600 ? status : 400;
  console.error(`[api] ${c.req.method} ${c.req.path}: ${err.message}`);
  return c.json({ error: err.message }, code as 400);
});

app.route('/api', system);
app.route('/api', core);
app.route('/api', agentRoutes);
app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Not found' }, 404) : c.text('Not found', 404)));

// Serve the built web app when present (production mode); in dev, Vite proxies /api to this server.
if (fs.existsSync(config.webDist)) {
  const rel = path.relative(process.cwd(), config.webDist).split(path.sep).join('/');
  app.use('/*', serveStatic({ root: rel }));
  app.get('*', (c) => (c.req.path.startsWith('/api/') ? c.notFound() : c.html(fs.readFileSync(path.join(config.webDist, 'index.html'), 'utf8'))));
}

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`SchemaForge server listening on http://${config.host}:${info.port}  (data: ${config.dataDir})`);
  if (!fs.existsSync(config.webDist)) console.log('Web UI not built; run `npm run dev:web` for the Vite dev server or `npm run build` for production.');
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close();
    void closeAll().finally(() => process.exit(0));
  });
}
