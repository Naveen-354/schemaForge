import type { SqlClassification, SqlRisk } from '@schemaforge/shared';

/** Strip comments and string literals so keyword detection is not fooled by their contents. */
export function stripSql(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const n = sql[i + 1];
    if (c === '-' && n === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < sql.length) {
        if (sql[i] === q) {
          if (sql[i + 1] === q) { i += 2; continue; }
          break;
        }
        i++;
      }
      i++;
      out += q + q;
      continue;
    }
    if (c === '$' && n === '$') {
      const end = sql.indexOf('$$', i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += "''";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export function splitStatements(sql: string): string[] {
  const stripped = stripSql(sql);
  // Split on semicolons in the stripped text, then map back by proportional index is unsafe; instead split original
  // using positions computed from stripped text (stripped text preserves length only for non-literal parts).
  // Simpler: split the *stripped* text and treat each as a statement for classification purposes.
  return stripped.split(';').map((s) => s.trim()).filter(Boolean);
}

const RISK_ORDER: SqlRisk[] = ['safe', 'write', 'ddl', 'destructive'];

function maxRisk(a: SqlRisk, b: SqlRisk): SqlRisk {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;
}

function classifyOne(stmt: string): { risk: SqlRisk; type: string; reason: string } {
  const s = stmt.replace(/\s+/g, ' ').trim();
  const upper = s.toUpperCase();
  const first = upper.split(' ')[0] ?? '';
  const second = upper.split(' ')[1] ?? '';

  if (/^(SELECT|WITH|SHOW|VALUES|TABLE|PRAGMA)\b/.test(upper)) {
    if (/^WITH\b/.test(upper) && /\b(INSERT|UPDATE|DELETE)\b/.test(upper)) {
      return { risk: 'write', type: 'WITH…DML', reason: 'CTE contains a data-modifying statement' };
    }
    if (/\bINTO\s+(?!TEMP|TEMPORARY)\w/.test(upper) && /^SELECT/.test(upper)) {
      return { risk: 'ddl', type: 'SELECT INTO', reason: 'SELECT INTO creates a table' };
    }
    if (/^PRAGMA\b/.test(upper) && /=/.test(upper)) return { risk: 'write', type: 'PRAGMA', reason: 'PRAGMA assignment' };
    return { risk: 'safe', type: first, reason: 'read-only query' };
  }
  if (/^EXPLAIN\b/.test(upper)) {
    if (/\bANALYZE\b/.test(upper) && /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE)\b/.test(upper)) {
      return { risk: 'write', type: 'EXPLAIN ANALYZE', reason: 'EXPLAIN ANALYZE executes the statement' };
    }
    return { risk: 'safe', type: 'EXPLAIN', reason: 'query plan only' };
  }
  if (/^(DROP|TRUNCATE)\b/.test(upper)) return { risk: 'destructive', type: `${first} ${second}`.trim(), reason: `${first} permanently removes data or structure` };
  if (/^DELETE\b/.test(upper)) {
    if (!/\bWHERE\b/.test(upper)) return { risk: 'destructive', type: 'DELETE', reason: 'DELETE without WHERE affects every row' };
    return { risk: 'write', type: 'DELETE', reason: 'row deletion' };
  }
  if (/^UPDATE\b/.test(upper)) {
    if (!/\bWHERE\b/.test(upper)) return { risk: 'destructive', type: 'UPDATE', reason: 'UPDATE without WHERE affects every row' };
    return { risk: 'write', type: 'UPDATE', reason: 'row modification' };
  }
  if (/^(INSERT|MERGE|UPSERT|REPLACE|COPY)\b/.test(upper)) return { risk: 'write', type: first, reason: 'data insertion' };
  if (/^ALTER\b/.test(upper)) {
    if (/\bDROP\s+(COLUMN|CONSTRAINT|INDEX|PARTITION)?\b/.test(upper)) return { risk: 'destructive', type: 'ALTER…DROP', reason: 'ALTER drops a column/constraint' };
    if (/\b(TYPE|SET DATA TYPE)\b/.test(upper)) return { risk: 'destructive', type: 'ALTER…TYPE', reason: 'column type change may rewrite/lose data' };
    return { risk: 'ddl', type: `ALTER ${second}`, reason: 'schema change' };
  }
  if (/^(CREATE|COMMENT|RENAME|REINDEX|VACUUM|ANALYZE|CLUSTER|REFRESH)\b/.test(upper)) {
    if (/^CREATE\s+OR\s+REPLACE\b/.test(upper)) return { risk: 'ddl', type: 'CREATE OR REPLACE', reason: 'replaces an existing object' };
    return { risk: 'ddl', type: `${first} ${second}`.trim(), reason: 'schema/maintenance operation' };
  }
  if (/^(GRANT|REVOKE|SET|RESET|BEGIN|START|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|LOCK|DO|CALL|EXECUTE|EXEC|PREPARE|DEALLOCATE|DISCARD|LISTEN|NOTIFY|UNLISTEN)\b/.test(upper)) {
    if (/^(SET|RESET|BEGIN|START|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/.test(upper)) return { risk: 'write', type: first, reason: 'session/transaction control' };
    if (/^(CALL|DO|EXECUTE|EXEC)\b/.test(upper)) return { risk: 'write', type: first, reason: 'procedure execution may modify data' };
    return { risk: 'ddl', type: first, reason: 'privilege/maintenance statement' };
  }
  return { risk: 'ddl', type: first || 'UNKNOWN', reason: 'unrecognized statement treated as schema-level risk' };
}

export function classifySql(sql: string): SqlClassification {
  const statements = splitStatements(sql);
  if (statements.length === 0) return { risk: 'safe', statementType: 'EMPTY', statements: 0, reasons: [] };
  let risk: SqlRisk = 'safe';
  const reasons: string[] = [];
  const types: string[] = [];
  for (const stmt of statements) {
    const c = classifyOne(stmt);
    risk = maxRisk(risk, c.risk);
    types.push(c.type);
    if (c.risk !== 'safe') reasons.push(`${c.type}: ${c.reason}`);
  }
  if (statements.length > 1) reasons.push(`${statements.length} statements in one batch`);
  return { risk, statementType: types.join(', '), statements: statements.length, reasons };
}

export function isReadOnly(sql: string): boolean {
  return classifySql(sql).risk === 'safe';
}

/** Extract identifiers that look like table references (FROM/JOIN/UPDATE/INTO/TABLE x). */
export function referencedTables(sql: string): string[] {
  const s = stripSql(sql);
  const re = /\b(?:FROM|JOIN|UPDATE|INTO|TABLE)\s+("?[\w$]+"?(?:\."?[\w$]+"?)?)/gi;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const name = m[1].replace(/"/g, '').toLowerCase();
    if (!['select', 'lateral', 'only', 'if', 'exists'].includes(name)) out.add(name);
  }
  return [...out];
}
