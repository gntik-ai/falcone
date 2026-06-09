/**
 * PostgreSQL metadata domain applier for tenant config reprovision.
 * @module appliers/postgres-applier
 */

import { compareResources, resolveAction, buildDiff } from '../reprovision/diff.mjs';
import { REDACTED_MARKER, zeroCounts } from '../reprovision/types.mjs';

const RESOURCE_TYPES = ['schemas', 'tables', 'views', 'extensions', 'grants'];
const IGNORE_KEYS = ['oid', 'tableowner', 'schemaname'];

// ---------------------------------------------------------------------------
// Validation helpers — pure, no I/O
// ---------------------------------------------------------------------------

/**
 * PostgreSQL base type names (without length/precision modifiers or array suffix).
 * Case-insensitive; used inside _isValidDataType.
 */
const _PG_BASE_TYPE_RE = new RegExp(
  '^(' +
    'boolean|bool' +
    '|smallint|int2' +
    '|integer|int|int4' +
    '|bigint|int8' +
    '|real|float4' +
    '|double precision|float8' +
    '|numeric|decimal' +
    '|money' +
    '|text' +
    '|varchar|character varying' +
    '|char|character' +
    '|bytea' +
    '|date' +
    '|time without time zone|time with time zone|timetz|time' +
    '|timestamp without time zone|timestamp with time zone|timestamptz|timestamp' +
    '|interval' +
    '|uuid' +
    '|json|jsonb' +
    '|inet|cidr|macaddr' +
    '|smallserial|serial2|serial|serial4|bigserial|serial8' +
  ')' +
  // optional length/precision: (n) or (n,m). _isValidDataType strips whitespace
  // around the punctuation first, so no internal \s* is needed here (avoids the
  // ambiguous nullable quantifiers that cause exponential backtracking / ReDoS).
  '(\\(\\d+(,\\d+)?\\))?' +
  // optional array suffix(es): [] or [n]
  '(\\[\\d*\\])*' +
  '$',
  'i',
);

/**
 * Returns true if the data_type string is a safe, known PostgreSQL type.
 * Quickly rejects anything containing `;`, `)` (outside allowed forms), quotes, or `--`.
 * @param {string} value
 * @returns {boolean}
 */
function _isValidDataType(value) {
  if (typeof value !== 'string') return false;
  let v = value.trim();
  // Fast-reject dangerous characters before regex
  if (/[;'"\\]/.test(v) || v.includes('--')) return false;
  // Normalize whitespace: collapse runs to single spaces (keeps multi-word types
  // like "timestamp with time zone") and drop spaces around ( ) , [ ] so the
  // allowlist regex needs no internal \s* (which would risk ReDoS).
  v = v.replace(/\s+/g, ' ').replace(/ ?([(),[\]]) ?/g, '$1');
  return _PG_BASE_TYPE_RE.test(v);
}

/**
 * Returns true if the column_default value is safe to interpolate.
 * Accepts: numeric literals, single-quoted strings (no embedded quote/semicolon),
 * true/false/null, now(), gen_random_uuid(), CURRENT_TIMESTAMP.
 * @param {string|null|undefined} value
 * @returns {boolean}
 */
function _isSafeColumnDefault(value) {
  if (value == null) return true; // no default → fine
  if (typeof value !== 'string') return false;
  const v = value.trim();
  // Numeric literal (including negative)
  if (/^-?\d+(\.\d+)?$/.test(v)) return true;
  // Single-quoted string literal — no embedded single-quote, no semicolon
  if (/^'[^';]*'$/.test(v)) return true;
  // Boolean / null keywords
  if (/^(true|false|null)$/i.test(v)) return true;
  // Approved zero-arg function calls
  if (/^(now\(\)|gen_random_uuid\(\)|CURRENT_TIMESTAMP)$/i.test(v)) return true;
  return false;
}

/** Fixed set of SQL privilege keywords (case-insensitive trimmed match). */
const _ALLOWED_PRIVILEGES = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']);

/**
 * Returns true if privilege_type is in the fixed SQL privilege keyword set.
 * @param {string} value
 * @returns {boolean}
 */
function _isValidPrivilege(value) {
  if (typeof value !== 'string') return false;
  return _ALLOWED_PRIVILEGES.has(value.trim().toUpperCase());
}

/**
 * Validate ALL resource items in domainData BEFORE any I/O.
 * Returns an array of { resourceType, item, messages[] } for every invalid item.
 * @param {Object} domainData
 * @returns {{ resourceType: string, itemName: string, messages: string[] }[]}
 */
function _validateAll(domainData) {
  const errors = [];

  for (const resourceType of RESOURCE_TYPES) {
    const items = domainData[resourceType];
    if (!Array.isArray(items)) continue;

    for (const item of items) {
      const itemName = item.name ?? 'unknown';
      const messages = [];

      if (resourceType === 'tables' && Array.isArray(item.columns)) {
        for (const col of item.columns) {
          const colName = col.column_name ?? col.name ?? '?';
          if (!_isValidDataType(col.data_type)) {
            messages.push(`Column '${colName}': invalid data_type '${col.data_type}'`);
          }
          if (!_isSafeColumnDefault(col.column_default)) {
            messages.push(`Column '${colName}': unsafe column_default '${col.column_default}'`);
          }
        }
      }

      if (resourceType === 'grants') {
        if (!_isValidPrivilege(item.privilege_type)) {
          messages.push(`Grant: invalid privilege_type '${item.privilege_type}'`);
        }
      }

      if (resourceType === 'views' && item.definition != null) {
        messages.push(`View '${itemName}': tenant-supplied 'definition' is not permitted`);
      }

      if (messages.length > 0) {
        errors.push({ resourceType, itemName, messages });
      }
    }
  }

  return errors;
}

/**
 * @param {string} tenantId
 * @param {Object} domainData
 * @param {Object} options
 * @returns {Promise<import('../reprovision/types.mjs').DomainResult>}
 */
export async function apply(tenantId, domainData, options = {}) {
  const { dryRun = false, credentials = {}, log = console } = options;
  const domain_key = 'postgres_metadata';

  if (!domainData || _isEmpty(domainData)) {
    return { domain_key, status: 'applied', resource_results: [], counts: zeroCounts(), message: 'empty domain' };
  }

  const counts = zeroCounts();
  const resource_results = [];
  let hasWarnings = false;

  const pgClient = credentials.pgClient ?? null;

  // Helper for PostgreSQL queries
  const query = credentials.query ?? (async (sql, params) => {
    if (!pgClient) throw new Error('No PostgreSQL client configured for reprovision');
    const res = await pgClient.query(sql, params);
    return res.rows;
  });

  const schema = domainData.schema ?? tenantId.replace(/-/g, '_');

  // Validation pass — pure, no query calls.
  // Reject the ENTIRE operation if ANY item is invalid.
  const validationErrors = _validateAll(domainData);
  if (validationErrors.length > 0) {
    const errorCounts = zeroCounts();
    const errorResults = validationErrors.map(({ resourceType, itemName, messages }) => {
      errorCounts.errors++;
      return {
        resource_type: resourceType,
        resource_name: itemName,
        resource_id: null,
        action: 'error',
        message: messages.join('; '),
        warnings: [],
        diff: null,
      };
    });
    return { domain_key, status: 'error', resource_results: errorResults, counts: errorCounts, message: 'Validation failed' };
  }

  for (const resourceType of RESOURCE_TYPES) {
    const items = domainData[resourceType];
    if (!Array.isArray(items)) continue;

    for (const item of items) {
      try {
        const result = await _processResource(resourceType, item, { dryRun, query, schema, log });
        resource_results.push(result);
        _updateCounts(counts, result.action);
        if (result.warnings.length > 0) hasWarnings = true;
      } catch (err) {
        resource_results.push({
          resource_type: resourceType,
          resource_name: item.name ?? 'unknown',
          resource_id: null,
          action: 'error',
          message: err.message,
          warnings: [],
          diff: null,
        });
        counts.errors++;
      }
    }
  }

  const status = _resolveStatus(counts, dryRun, hasWarnings);
  return { domain_key, status, resource_results, counts, message: null };
}

/**
 * Symmetric reverse of {@link apply}: drops the tenant's Postgres schema
 * (CASCADE) using the SAME injected I/O client. Idempotent (DROP SCHEMA IF
 * EXISTS) and honors options.dryRun. Returns a DomainResult.
 *
 * @param {string} tenantId
 * @param {Object} domainData
 * @param {Object} options
 * @returns {Promise<import('../reprovision/types.mjs').DomainResult>}
 */
export async function teardown(tenantId, domainData = {}, options = {}) {
  const { dryRun = false, credentials = {}, log = console } = options;
  const domain_key = 'postgres_metadata';
  const counts = zeroCounts();
  const resource_results = [];

  const pgClient = credentials.pgClient ?? null;
  const query = credentials.query ?? (async (sql, params) => {
    if (!pgClient) throw new Error('No PostgreSQL client configured for teardown');
    const res = await pgClient.query(sql, params);
    return res.rows;
  });

  const schema = domainData?.schema ?? tenantId.replace(/-/g, '_');

  try {
    if (!dryRun) {
      await query(`DROP SCHEMA IF EXISTS ${_ident(schema)} CASCADE`, []);
    }
    resource_results.push({
      resource_type: 'schema',
      resource_name: schema,
      resource_id: schema,
      action: dryRun ? 'would_remove' : 'removed',
      message: null,
      warnings: [],
      diff: null,
    });
  } catch (err) {
    resource_results.push({
      resource_type: 'schema',
      resource_name: schema,
      resource_id: schema,
      action: 'error',
      message: err.message,
      warnings: [],
      diff: null,
    });
    counts.errors++;
  }

  const status = counts.errors > 0 ? 'error' : (dryRun ? 'would_apply' : 'applied');
  return { domain_key, status, resource_results, counts, message: null };
}

async function _processResource(resourceType, item, { dryRun, query, schema, log }) {
  const name = item.name ?? 'unknown';
  const warnings = [];
  const cleanedItem = _stripRedacted(item, warnings, name);

  let existing = null;
  switch (resourceType) {
    case 'schemas': {
      const rows = await query('SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1', [name]);
      if (rows.length > 0) existing = { name };
      break;
    }
    case 'tables': {
      const rows = await query(
        'SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position',
        [schema, name]
      );
      if (rows.length > 0) existing = { name, columns: rows };
      break;
    }
    case 'views': {
      const rows = await query('SELECT definition FROM pg_views WHERE schemaname = $1 AND viewname = $2', [schema, name]);
      if (rows.length > 0) existing = { name, definition: rows[0].definition };
      break;
    }
    case 'extensions': {
      const rows = await query('SELECT extname, extversion FROM pg_extension WHERE extname = $1', [name]);
      if (rows.length > 0) existing = { name, version: rows[0].extversion };
      break;
    }
    case 'grants': {
      const rows = await query(
        'SELECT grantee, privilege_type, table_name FROM information_schema.role_table_grants WHERE table_schema = $1 AND grantee = $2 AND table_name = $3 AND privilege_type = $4',
        [schema, item.grantee, item.table_name, item.privilege_type]
      );
      if (rows.length > 0) existing = { grantee: item.grantee, table_name: item.table_name, privilege_type: item.privilege_type };
      break;
    }
  }

  const existsInTarget = existing !== null;
  const comparison = existsInTarget ? compareResources(existing, cleanedItem, IGNORE_KEYS) : 'different';
  const action = resolveAction(existsInTarget, comparison, dryRun);

  if (action === 'created' && !dryRun) {
    await _createResource(resourceType, cleanedItem, { query, schema });
  }

  const diff = (action === 'conflict' || action === 'would_conflict') ? buildDiff(existing, cleanedItem) : null;
  const finalAction = warnings.length > 0 && (action === 'created' || action === 'would_create')
    ? (dryRun ? 'would_create' : 'applied_with_warnings')
    : action;

  return { resource_type: resourceType, resource_name: name, resource_id: null, action: finalAction, message: null, warnings, diff };
}

async function _createResource(resourceType, item, { query, schema }) {
  switch (resourceType) {
    case 'schemas':
      await query(`CREATE SCHEMA IF NOT EXISTS ${_ident(item.name)}`, []);
      break;
    case 'tables':
      // Create table from column definitions if available
      if (item.columns && item.columns.length > 0) {
        const colDefs = item.columns.map(c =>
          `${_ident(c.column_name ?? c.name)} ${c.data_type}${c.is_nullable === 'NO' ? ' NOT NULL' : ''}${c.column_default ? ` DEFAULT ${c.column_default}` : ''}`
        ).join(', ');
        await query(`CREATE TABLE IF NOT EXISTS ${_ident(schema)}.${_ident(item.name)} (${colDefs})`, []);
      }
      break;
    case 'views':
      if (item.definition) {
        await query(`CREATE OR REPLACE VIEW ${_ident(schema)}.${_ident(item.name)} AS ${item.definition}`, []);
      }
      break;
    case 'extensions':
      await query(`CREATE EXTENSION IF NOT EXISTS ${_ident(item.name)}`, []);
      break;
    case 'grants':
      if (item.grantee && item.privilege_type && item.table_name) {
        await query(`GRANT ${item.privilege_type} ON ${_ident(schema)}.${_ident(item.table_name)} TO ${_ident(item.grantee)}`, []);
      }
      break;
  }
}

function _ident(name) {
  // Simple SQL identifier quoting
  return `"${name.replace(/"/g, '""')}"`;
}

function _stripRedacted(item, warnings, resourceName) {
  const clone = structuredClone(item);
  _walk(clone, [], warnings, resourceName);
  return clone;
}

function _walk(obj, path, warnings, resourceName) {
  if (!obj || typeof obj !== 'object') return;
  for (const [key, val] of Object.entries(obj)) {
    if (val === REDACTED_MARKER) {
      delete obj[key];
      warnings.push(`Redacted field '${[...path, key].join('.')}' omitted for resource '${resourceName}'`);
    } else if (typeof val === 'object' && val !== null) {
      _walk(val, [...path, key], warnings, resourceName);
    }
  }
}

function _isEmpty(domainData) {
  for (const rt of RESOURCE_TYPES) {
    if (Array.isArray(domainData[rt]) && domainData[rt].length > 0) return false;
  }
  return true;
}

function _updateCounts(counts, action) {
  if (action === 'created' || action === 'would_create' || action === 'applied_with_warnings') counts.created++;
  else if (action === 'skipped' || action === 'would_skip') counts.skipped++;
  else if (action === 'conflict' || action === 'would_conflict') counts.conflicts++;
  else if (action === 'error') counts.errors++;
}

function _resolveStatus(counts, dryRun, hasWarnings) {
  if (counts.errors > 0 && counts.created === 0 && counts.skipped === 0 && counts.conflicts === 0) return 'error';
  if (counts.conflicts > 0 && counts.created === 0) return dryRun ? 'would_conflict' : 'conflict';
  if (hasWarnings) return dryRun ? 'would_apply_with_warnings' : 'applied_with_warnings';
  if (counts.created > 0) return dryRun ? 'would_apply' : 'applied';
  return dryRun ? 'would_skip' : 'skipped';
}
