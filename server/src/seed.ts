import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config, repoRoot } from './config.js';
import { agents, connections, knowledge, projects, savedQueries, workspaces } from './store/repos.js';
import { defaultProviderId, getProvider } from './ai/providers/index.js';

const SAMPLE_SCHEMA = `
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  external_ref TEXT,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  pan TEXT,
  phone TEXT,
  kyc_status TEXT NOT NULL DEFAULT 'PENDING',
  risk_profile TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE fund_houses (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  amc_code TEXT NOT NULL UNIQUE
);
CREATE TABLE funds (
  id INTEGER PRIMARY KEY,
  fund_house_id INTEGER NOT NULL REFERENCES fund_houses(id),
  isin TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  nav REAL NOT NULL,
  expense_ratio REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_funds_house ON funds(fund_house_id);
CREATE TABLE folios (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  fund_house_id INTEGER NOT NULL REFERENCES fund_houses(id),
  folio_number TEXT NOT NULL,
  opened_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_folios_customer ON folios(customer_id);
CREATE TABLE sip_mandates (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  fund_id INTEGER NOT NULL REFERENCES funds(id),
  folio_id INTEGER REFERENCES folios(id),
  amount_paise INTEGER NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'MONTHLY',
  debit_day INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  start_date TEXT NOT NULL,
  end_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_sip_customer ON sip_mandates(customer_id);
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY,
  folio_id INTEGER NOT NULL REFERENCES folios(id),
  fund_id INTEGER NOT NULL REFERENCES funds(id),
  sip_mandate_id INTEGER REFERENCES sip_mandates(id),
  txn_type TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  units REAL NOT NULL,
  nav REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'SETTLED',
  txn_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_txn_folio ON transactions(folio_id);
CREATE INDEX ix_txn_date ON transactions(txn_date);
CREATE TABLE holdings (
  folio_id INTEGER NOT NULL REFERENCES folios(id),
  fund_id INTEGER NOT NULL REFERENCES funds(id),
  units REAL NOT NULL,
  invested_paise INTEGER NOT NULL,
  current_value_paise INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (folio_id, fund_id)
);
CREATE TABLE kyc_documents (
  customer_id INTEGER NOT NULL,
  doc_type TEXT NOT NULL,
  doc_number TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  payload TEXT,
  logged_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE VIEW customer_portfolio AS
  SELECT c.id AS customer_id, c.full_name, SUM(h.invested_paise) AS invested_paise, SUM(h.current_value_paise) AS current_value_paise
  FROM customers c JOIN folios f ON f.customer_id = c.id JOIN holdings h ON h.folio_id = f.id
  GROUP BY c.id, c.full_name;
`;

function seedSampleData(db: DatabaseSync): void {
  const names = ['Aarav Mehta', 'Diya Sharma', 'Kabir Rao', 'Ananya Iyer', 'Vihaan Nair', 'Ishita Bose', 'Rohan Kulkarni', 'Meera Pillai', 'Arjun Desai', 'Saanvi Reddy', 'Advait Joshi', 'Nisha Menon'];
  const insCust = db.prepare('INSERT INTO customers (id, external_ref, full_name, email, pan, phone, kyc_status, risk_profile) VALUES (?,?,?,?,?,?,?,?)');
  names.forEach((n, i) => insCust.run(i + 1, `CUST-${1000 + i}`, n, `${n.toLowerCase().replace(' ', '.')}@example.com`, `ABCDE${1000 + i}F`, `+91 98${String(10000000 + i * 7919).slice(0, 8)}`, i % 5 === 0 ? 'PENDING' : 'VERIFIED', ['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE'][i % 3]));
  db.prepare('INSERT INTO fund_houses (id, name, amc_code) VALUES (1,?,?),(2,?,?),(3,?,?)').run('Nimbus Asset Management', 'NIMB', 'Harbor Mutual', 'HARB', 'Summit Capital', 'SUMM');
  const funds: [number, number, string, string, string, number, number][] = [
    [1, 1, 'INF001A01001', 'Nimbus Flexi Cap Fund', 'EQUITY', 84.12, 0.65], [2, 1, 'INF001A01002', 'Nimbus Liquid Fund', 'DEBT', 2456.7, 0.15],
    [3, 2, 'INF002B01001', 'Harbor Bluechip Fund', 'EQUITY', 51.3, 0.72], [4, 2, 'INF002B01002', 'Harbor Balanced Advantage', 'HYBRID', 33.8, 0.9],
    [5, 3, 'INF003C01001', 'Summit Small Cap Fund', 'EQUITY', 120.45, 0.85], [6, 3, 'INF003C01002', 'Summit Index Fund Nifty 50', 'INDEX', 18.9, 0.1],
  ];
  const insFund = db.prepare('INSERT INTO funds (id, fund_house_id, isin, name, category, nav, expense_ratio) VALUES (?,?,?,?,?,?,?)');
  for (const f of funds) insFund.run(...f);
  const insFolio = db.prepare('INSERT INTO folios (id, customer_id, fund_house_id, folio_number) VALUES (?,?,?,?)');
  let folioId = 0;
  const foliosByCustomer = new Map<number, number[]>();
  for (let c = 1; c <= names.length; c++) {
    const houses = c % 2 === 0 ? [1, 2] : [c % 3 + 1];
    for (const h of houses) { folioId++; insFolio.run(folioId, c, h, `${h}${String(100000 + folioId * 37)}/${c}`); foliosByCustomer.set(c, [...(foliosByCustomer.get(c) ?? []), folioId]); }
  }
  const insSip = db.prepare('INSERT INTO sip_mandates (id, customer_id, fund_id, folio_id, amount_paise, frequency, debit_day, status, start_date, end_date) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const insTxn = db.prepare('INSERT INTO transactions (folio_id, fund_id, sip_mandate_id, txn_type, amount_paise, units, nav, status, txn_date) VALUES (?,?,?,?,?,?,?,?,?)');
  const insHold = db.prepare('INSERT INTO holdings (folio_id, fund_id, units, invested_paise, current_value_paise) VALUES (?,?,?,?,?)');
  let sipId = 0;
  for (let c = 1; c <= names.length; c++) {
    const folios = foliosByCustomer.get(c) ?? [];
    for (const fo of folios) {
      const houseFunds = funds.filter((f) => f[1] === (fo % 3) + 1);
      const fund = houseFunds[0] ?? funds[0];
      const amount = (c * 2500 + fo * 500) * 100;
      sipId++;
      insSip.run(sipId, c, fund[0], fo, amount, 'MONTHLY', (c % 28) + 1, c % 4 === 0 ? 'PAUSED' : 'ACTIVE', '2024-01-05', null);
      let units = 0; let invested = 0;
      for (let m = 0; m < 12 + c; m++) {
        const nav = fund[5] * (1 + (m - 6) / 100);
        const u = amount / 100 / nav;
        units += u; invested += amount;
        insTxn.run(fo, fund[0], sipId, 'SIP_PURCHASE', amount, u, nav, 'SETTLED', `2024-${String((m % 12) + 1).padStart(2, '0')}-05`);
      }
      insHold.run(fo, fund[0], units, invested, Math.round(units * fund[5] * 100));
    }
  }
  const insKyc = db.prepare('INSERT INTO kyc_documents (customer_id, doc_type, doc_number, verified) VALUES (?,?,?,?)');
  for (let c = 1; c <= names.length; c++) { insKyc.run(c, 'PAN', `ABCDE${1000 + c}F`, 1); if (c % 2) insKyc.run(c, 'AADHAAR', `XXXX-XXXX-${1000 + c}`, c % 5 !== 0 ? 1 : 0); }
  db.prepare("INSERT INTO audit_log (actor, action, entity, entity_id, payload) VALUES ('system','SEED','database',NULL,'{}')").run();
}

export function ensureSampleDatabase(): string {
  const file = path.join(config.dataDir, 'sample-investment.db');
  if (fs.existsSync(file)) return file;
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SAMPLE_SCHEMA);
  db.exec('BEGIN');
  seedSampleData(db);
  db.exec('COMMIT');
  db.close();
  return file;
}

export function seedIfEmpty(): void {
  if (workspaces.list().length > 0) return;
  console.log('[seed] creating default workspace, sample project and agents');
  const ws = workspaces.create('Personal');
  const project = projects.create({
    workspaceId: ws.id, name: 'Investment Platform (sample)',
    description: 'Sample mutual-fund platform database used to demonstrate SchemaForge.',
    rootPath: repoRoot,
    instructions: 'Money is stored as integer paise (1 rupee = 100 paise). Table names are plural snake_case. Every table should have created_at. Never drop tables in this project.',
  });
  projects.create({ workspaceId: ws.id, name: 'Experiments', description: 'Scratch space for trying things out.', rootPath: null });
  const sampleFile = ensureSampleDatabase();
  const conn = connections.create({ projectId: project.id, name: 'sample-investment (SQLite)', engine: 'sqlite', database: 'sample-investment', filePath: sampleFile });

  const providerId = defaultProviderId();
  const model = getProvider(providerId).defaultModel;
  const base = { workspaceId: ws.id, projectId: null as string | null, provider: providerId, model };
  agents.create({ ...base, name: 'Assistant', role: 'database assistant', instructions: 'Answer questions about the selected database and SQL precisely. Prefer showing SQL. Keep answers short.', permissions: { sql: { safe: 'allow', write: 'ask', ddl: 'ask', destructive: 'deny' } }, maxIterations: 12 });
  agents.create({ ...base, name: 'Database Agent', role: 'database engineer', instructions: 'Inspect schemas, analyze indexes and constraints, write SQL and migrations. Save deliverables as artifacts.', permissions: { sql: { safe: 'allow', write: 'ask', ddl: 'ask', destructive: 'deny' } } });
  agents.create({ ...base, name: 'Architect Agent', role: 'software architect', instructions: 'Review database designs for normalization, naming, relationships and evolution. Produce architecture decision artifacts.', permissions: { sql: { safe: 'allow', write: 'deny', ddl: 'deny', destructive: 'deny' } } });
  agents.create({ ...base, name: 'Performance Agent', role: 'query performance analyst', instructions: 'Use EXPLAIN and index metadata to find bottlenecks. Never claim timings you did not measure.', permissions: { sql: { safe: 'allow', write: 'deny', ddl: 'deny', destructive: 'deny' } } });
  agents.create({ ...base, name: 'Migration Agent', role: 'migration engineer', instructions: 'Generate reversible migrations with rollback sections. Execute DDL only after approval.', permissions: { sql: { safe: 'allow', write: 'ask', ddl: 'ask', destructive: 'ask' } } });
  agents.create({ ...base, name: 'Review Agent', role: 'code and schema reviewer', instructions: 'Combine upstream artifacts into a consolidated review with prioritized recommendations.', permissions: { sql: { safe: 'allow', write: 'deny', ddl: 'deny', destructive: 'deny' }, tools: { write_file: 'deny', run_command: 'deny' } } });

  const k = (category: string, title: string, content: string, tags: string[]) => knowledge.create({ projectId: project.id, scope: 'project', agentId: null, category, title, content, tags });
  k('convention', 'Money stored as integer paise', 'All monetary columns end in _paise and store integer paise. Never use REAL/float for money.', ['money', 'paise', 'convention']);
  k('convention', 'Naming', 'Tables are plural snake_case; foreign keys are <singular>_id; timestamps end with _at and are ISO-8601 text in SQLite / timestamptz in Postgres.', ['naming', 'convention']);
  k('business-rule', 'SIP mandate lifecycle', 'sip_mandates.status ∈ ACTIVE, PAUSED, CANCELLED, COMPLETED. A cancelled mandate must keep its transaction history.', ['sip', 'mandate', 'status']);
  k('known-problem', 'kyc_documents has no primary key', 'kyc_documents was created without a primary key or a foreign key to customers. Fix pending.', ['kyc', 'primary key', 'tech-debt']);
  k('decision', 'Holdings are denormalized', 'holdings is a materialized summary of transactions per folio/fund, refreshed nightly. Do not treat it as a source of truth.', ['holdings', 'denormalized']);

  savedQueries.create({ projectId: project.id, connectionId: conn.id, name: 'Customer portfolio (top 10)', description: 'Highest current value first', sql: 'SELECT customer_id, full_name, invested_paise / 100.0 AS invested_rupees, current_value_paise / 100.0 AS value_rupees\nFROM customer_portfolio\nORDER BY current_value_paise DESC\nLIMIT 10;' });
  savedQueries.create({ projectId: project.id, connectionId: conn.id, name: 'Active SIPs by fund', description: '', sql: 'SELECT f.name AS fund, COUNT(*) AS active_sips, SUM(s.amount_paise) / 100.0 AS monthly_rupees\nFROM sip_mandates s JOIN funds f ON f.id = s.fund_id\nWHERE s.status = \'ACTIVE\'\nGROUP BY f.name\nORDER BY monthly_rupees DESC;' });
}
