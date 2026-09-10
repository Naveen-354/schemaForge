import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeuristicProvider } from '../ai/providers/heuristic.js';
import type { ChatMessage } from '../ai/types.js';

const sql = "SELECT f.name, COUNT(*) AS sips FROM sip_mandates s JOIN funds f ON f.id = s.fund_id WHERE s.status = 'ACTIVE' GROUP BY f.name";
const prompt = `## Task\nWhy is this query slow?\n\n## Context\nSelected SQL:\n\`\`\`sql\n${sql}\n\`\`\``;
const tools = ['list_tables', 'describe_table', 'explain_sql', 'run_sql', 'create_artifact', 'search_schema'].map((name) => ({ name, description: '', inputSchema: {} }));

test('heuristic explains a slow query and attributes SQLite scans to tables', async () => {
  const p = new HeuristicProvider();
  const messages: ChatMessage[] = [{ role: 'user', content: [{ type: 'text', text: prompt }] }];
  const r1 = await p.complete({ model: 'h', system: '', messages, tools });
  assert.equal(r1.toolCalls[0]?.name, 'explain_sql');
  messages.push({ role: 'assistant', content: r1.toolCalls.map((c) => ({ type: 'tool_use' as const, id: c.id, name: c.name, input: c.input })) });
  messages.push({ role: 'user', content: [{ type: 'tool_result', toolUseId: r1.toolCalls[0].id, name: 'explain_sql', content: 'SCAN s\nSEARCH f USING INTEGER PRIMARY KEY (rowid=?)\nUSE TEMP B-TREE FOR GROUP BY' }] });
  const r2 = await p.complete({ model: 'h', system: '', messages, tools });
  assert.equal(r2.toolCalls[0]?.name, 'list_tables');
  messages.push({ role: 'assistant', content: r2.toolCalls.map((c) => ({ type: 'tool_use' as const, id: c.id, name: c.name, input: c.input })) });
  messages.push({ role: 'user', content: [{ type: 'tool_result', toolUseId: r2.toolCalls[0].id, name: 'list_tables', content: JSON.stringify({ tables: [{ schema: 'main', name: 'sip_mandates', kind: 'table', columns: 5, rows: 18, references: ['funds'] }, { schema: 'main', name: 'funds', kind: 'table', columns: 3, rows: 6, references: [] }] }) }] });
  const r3 = await p.complete({ model: 'h', system: '', messages, tools });
  assert.ok(r3.toolCalls.length > 0 && r3.toolCalls.every((c) => c.name === 'describe_table'), JSON.stringify(r3));
  messages.push({ role: 'assistant', content: r3.toolCalls.map((c) => ({ type: 'tool_use' as const, id: c.id, name: c.name, input: c.input })) });
  messages.push({ role: 'user', content: r3.toolCalls.map((c) => ({ type: 'tool_result' as const, toolUseId: c.id, name: 'describe_table', content: JSON.stringify({ table: { schema: 'main', name: String(c.input.table).split('.').pop(), kind: 'table', columns: [{ name: 'id', dataType: 'INTEGER', nullable: false, defaultValue: null, isPrimaryKey: true, ordinal: 1, comment: null }, { name: 'status', dataType: 'TEXT', nullable: false, defaultValue: null, isPrimaryKey: false, ordinal: 2, comment: null }], primaryKey: ['id'], foreignKeys: [], indexes: [], constraints: [], rowEstimate: 18, comment: null, definition: null } }) })) });
  const r4 = await p.complete({ model: 'h', system: '', messages, tools });
  assert.equal(r4.toolCalls.length, 0);
  assert.match(r4.text, /Full table scans on: \*\*sip_mandates\*\*/);
  assert.match(r4.text, /CREATE INDEX ix_sip_mandates_status/);
});
