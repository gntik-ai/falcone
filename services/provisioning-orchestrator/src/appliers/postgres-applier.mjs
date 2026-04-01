/**
 * PostgreSQL metadata domain applier for tenant config reprovision.
 * @module appliers/postgres-applier
 */

import { compareResources, resolveAction, buildDiff } from '../reprovision/diff.mjs';
import { REDACTED_MARKER, zeroCounts } from '../reprovision/types.mjs';

const RESOURCE_TYPES = ['schemas', 'tables', 'views', 'extensions', 'grants'];
const IGNORE_KEYS = ['oid', 'tableowner', 'schemaname'];

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
