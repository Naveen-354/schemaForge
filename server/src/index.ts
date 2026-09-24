import fs from 'node:fs';
import { serve } from '@hono/node-server';
import { config } from './config.js';
import { openDb } from './store/db.js';
import { seedIfEmpty } from './seed.js';
import { runtime } from './agents/runtime.js';
import { closeAll } from './dbs/manager.js';
import { createApp } from './app.js';
import { users } from './auth.js';

openDb();
seedIfEmpty();
runtime.init();

const app = createApp();

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`SchemaForge server listening on http://${config.host}:${info.port}  (data: ${config.dataDir})`);
  if (users.count() === 0) console.log('No accounts yet: open the app and create the owner account.');
  if (config.allowRegistration) console.log('SCHEMAFORGE_ALLOW_REGISTRATION is on: anyone who can reach this server can create an account.');
  if (!fs.existsSync(config.webDist)) console.log('Web UI not built; run `npm run dev:web` for the Vite dev server or `npm run build` for production.');
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close();
    void closeAll().finally(() => process.exit(0));
  });
}
