import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.SCHEMAFORGE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-adapter-'));
const { ensureSampleDatabase } = await import('../seed.js');
const { SqliteAdapter } = await import('../dbs/sqlite.js');

test('sqlite adapter introspects the sample database', async () => {
  const a = new SqliteAdapter({ engine: 'sqlite', database: 'x', filePath: ensureSampleDatabase() });
  const snap = await a.introspect();
  const sip = snap.tables.find((t) => t.name === 'sip_mandates')!;
  assert.equal(sip.primaryKey[0], 'id');
  assert.equal(sip.foreignKeys.length, 3);
  assert.ok(sip.indexes.some((i) => i.columns[0] === 'customer_id'));
  assert.ok(snap.tables.some((t) => t.kind === 'view' && t.name === 'customer_portfolio'));
  const r = await a.query('SELECT COUNT(*) AS n FROM customers');
  assert.equal(r.rows[0][0], 12);
  const dry = await a.query("INSERT INTO audit_log (actor, action, entity) VALUES ('t','t','t')", { dryRun: true });
  assert.equal(dry.affectedRows, 1);
  const after = await a.query("SELECT COUNT(*) AS n FROM audit_log WHERE actor = 't'");
  assert.equal(after.rows[0][0], 0, 'dry run must roll back');
  const plan = await a.explain('SELECT * FROM folios WHERE customer_id = 1');
  assert.match(plan, /ix_folios_customer/);
  await a.close();
});
