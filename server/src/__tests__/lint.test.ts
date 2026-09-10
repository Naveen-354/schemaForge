import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TableInfo } from '@schemaforge/shared';
import { lintTables } from '../sql/lint.js';

const col = (name: string, dataType = 'integer', extra: Partial<TableInfo['columns'][number]> = {}) => ({ name, dataType, nullable: true, defaultValue: null, isPrimaryKey: false, ordinal: 1, comment: null, ...extra });
const table = (name: string, t: Partial<TableInfo>): TableInfo => ({ schema: 'public', name, kind: 'table', columns: [], primaryKey: [], foreignKeys: [], indexes: [], constraints: [], rowEstimate: 10, comment: null, definition: null, ...t });

test('detects missing primary key and unindexed foreign keys', () => {
  const customers = table('customers', { columns: [col('id', 'integer', { isPrimaryKey: true }), col('email', 'text'), col('created_at', 'timestamptz')], primaryKey: ['id'] });
  const orders = table('orders', {
    columns: [col('customer_id'), col('total_amount', 'double precision'), col('created_at', 'timestamptz')],
    foreignKeys: [{ name: 'fk', columns: ['customer_id'], refSchema: 'public', refTable: 'customers', refColumns: ['id'], onDelete: null, onUpdate: null }],
  });
  const codes = lintTables([customers, orders]).map((f) => `${f.code}:${f.table}`);
  assert.ok(codes.includes('NO_PRIMARY_KEY:orders'));
  assert.ok(codes.includes('FK_NOT_INDEXED:orders'));
  assert.ok(codes.includes('FLOAT_MONEY:orders'));
  assert.ok(codes.includes('LIKELY_UNIQUE:customers'));
  assert.ok(!codes.includes('FK_TARGET_MISSING:orders'));
});

test('FK target outside the inspected set is fine when known', () => {
  const orders = table('orders', {
    columns: [col('id', 'integer', { isPrimaryKey: true }), col('customer_id'), col('created_at', 'timestamptz')], primaryKey: ['id'],
    indexes: [{ name: 'ix', columns: ['customer_id'], unique: false, primary: false, definition: null }],
    foreignKeys: [{ name: 'fk', columns: ['customer_id'], refSchema: 'public', refTable: 'customers', refColumns: ['id'], onDelete: null, onUpdate: null }],
  });
  assert.ok(lintTables([orders]).some((f) => f.code === 'FK_TARGET_MISSING'));
  assert.ok(!lintTables([orders], ['customers']).some((f) => f.code === 'FK_TARGET_MISSING'));
});
