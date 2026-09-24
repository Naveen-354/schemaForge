import fs from 'node:fs';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from './config.js';
import { requireAuth, type AuthEnv } from './auth.js';
import { auth } from './routes/auth.js';
import { core } from './routes/core.js';
import { agentRoutes } from './routes/agents.js';
import { system } from './routes/system.js';

/** Build the HTTP app. Kept separate from startup so tests can call it with `app.request()`. */
export function createApp(): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  // Only the app's own origins may make cross-origin, credentialed requests.
  app.use('/api/*', cors({ origin: (origin) => (config.allowedOrigins.includes(origin) ? origin : null), credentials: true }));
  app.use('/api/*', requireAuth);

  app.onError((err, c) => {
    const status = (err as { status?: number }).status;
    const code = typeof status === 'number' && status >= 400 && status < 600 ? status : 400;
    if (code >= 500 || !(err as { status?: number }).status) console.error(`[api] ${c.req.method} ${c.req.path}: ${err.message}`);
    return c.json({ error: err.message }, code as 400);
  });

  app.route('/api/auth', auth);
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
  return app;
}
