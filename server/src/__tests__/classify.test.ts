import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySql, referencedTables, stripSql } from '../sql/classify.js';

test('read-only statements are safe', () => {
  assert.equal(classifySql('SELECT * FROM customers').risk, 'safe');
  assert.equal(classifySql('  with x as (select 1) select * from x').risk, 'safe');
  assert.equal(classifySql('EXPLAIN SELECT 1').risk, 'safe');
  assert.equal(classifySql("SELECT 'DROP TABLE x' AS s -- DELETE FROM y").risk, 'safe');
});

test('writes and DDL are classified', () => {
  assert.equal(classifySql('INSERT INTO t VALUES (1)').risk, 'write');
  assert.equal(classifySql('UPDATE t SET a = 1 WHERE id = 2').risk, 'write');
  assert.equal(classifySql('CREATE INDEX ix ON t (a)').risk, 'ddl');
  assert.equal(classifySql('ALTER TABLE t ADD COLUMN x int').risk, 'ddl');
});

test('destructive statements are flagged', () => {
  assert.equal(classifySql('DROP TABLE t').risk, 'destructive');
  assert.equal(classifySql('TRUNCATE t').risk, 'destructive');
  assert.equal(classifySql('DELETE FROM t').risk, 'destructive');
  assert.equal(classifySql('UPDATE t SET a = 1').risk, 'destructive');
  assert.equal(classifySql('ALTER TABLE t DROP COLUMN a').risk, 'destructive');
});

test('batches take the highest risk', () => {
  const c = classifySql('SELECT 1; DELETE FROM t WHERE id = 1; DROP TABLE t');
  assert.equal(c.risk, 'destructive');
  assert.equal(c.statements, 3);
});

test('strip removes comments and literals', () => {
  assert.equal(stripSql("select 'a;b' /* ; */ -- x\n from t").replace(/\s+/g, ' ').trim(), "select '' from t");
});

test('referenced tables are extracted', () => {
  assert.deepEqual(referencedTables('SELECT * FROM public.customers c JOIN folios f ON f.customer_id = c.id'), ['public.customers', 'folios']);
});
