/**
 * PostgreSQL metadata collector.
 * Extracts schema structure, tables, columns, constraints, indexes, views, extensions, and grants.
 * @module collectors/postgres-collector
 */

import { redactSensitiveFields } from './types.mjs';

const DOMAIN_KEY = 'postgres_metadata';

/**
 * @param {string} tenantId
 * @param {Object} [options]
 * @param {Object} [options.pgPool] - injectable pg Pool for testing
 * @returns {Promise<import('./types.mjs').CollectorResult>}
 */
export async function collect(tenantId, options = {}) {
  const exportedAt = new Date().toISOString();
  let pool = options.pgPool ?? null;
  let shouldEnd = false;

  const databaseUrl = process.env.CONFIG_EXPORT_PG_DATABASE_URL;
  if (!databaseUrl && !pool) {
    return { domain_key: DOMAIN_KEY, status: 'not_available', exported_at: exportedAt, reason: 'PostgreSQL DSN not configured (CONFIG_EXPORT_PG_DATABASE_URL)', data: null };
  }

  try {
    if (!pool) {
      const pg = await import('pg');
      const Pool = pg.default?.Pool ?? pg.Pool;
      pool = new Pool({ connectionString: databaseUrl, max: 2 });
      shouldEnd = true;
    }

    const schemaPrefix = process.env.CONFIG_EXPORT_PG_SCHEMA_PREFIX ?? '';
    const schemaName = schemaPrefix ? `${schemaPrefix}${tenantId}` : tenantId;

    // Check schema exists
    const schemaCheck = await pool.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
      [schemaName]
    );
    if (schemaCheck.rows.length === 0) {
      return { domain_key: DOMAIN_KEY, status: 'empty', exported_at: exportedAt, items_count: 0, data: { schemas: [] } };
    }

    // Tables
    const tablesResult = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`,
      [schemaName]
    );

    const tables = [];
    for (const row of tablesResult.rows) {
      const tableName = row.table_name;

      // Columns
      const colsResult = await pool.query(
        `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
        [schemaName, tableName]
      );

      // Constraints
      const consResult = await pool.query(
        `SELECT tc.constraint_name, tc.constraint_type, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         WHERE tc.table_schema = $1 AND tc.table_name = $2
         ORDER BY tc.constraint_name, kcu.ordinal_position`,
        [schemaName, tableName]
      );

      // Indexes
      const idxResult = await pool.query(
        `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2`,
        [schemaName, tableName]
      );

      tables.push({
        table_name: tableName,
        columns: colsResult.rows,
        constraints: consResult.rows,
        indexes: idxResult.rows,
      });
    }

    // Views
    const viewsResult = await pool.query(
      `SELECT table_name, view_definition FROM information_schema.views WHERE table_schema = $1 ORDER BY table_name`,
      [schemaName]
    );

    // Extensions
    const extResult = await pool.query(`SELECT extname, extversion FROM pg_extension ORDER BY extname`);

    // Grants
    const grantsResult = await pool.query(
      `SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants WHERE table_schema = $1 ORDER BY table_name, grantee`,
      [schemaName]
    );

    // Schema owner
    const ownerResult = await pool.query(
      `SELECT nspowner::regrole::text AS owner FROM pg_namespace WHERE nspname = $1`,
      [schemaName]
    );

    if (tables.length === 0 && viewsResult.rows.length === 0) {
      return { domain_key: DOMAIN_KEY, status: 'empty', exported_at: exportedAt, items_count: 0, data: { schemas: [{ schema_name: schemaName, owner: ownerResult.rows[0]?.owner ?? null, tables: [], views: [], extensions: extResult.rows, grants: grantsResult.rows }] } };
    }

    const data = {
      schemas: [{
        schema_name: schemaName,
        owner: ownerResult.rows[0]?.owner ?? null,
        tables,
        views: viewsResult.rows,
        extensions: extResult.rows,
        grants: grantsResult.rows,
      }],
    };

    const itemsCount = tables.length + viewsResult.rows.length;
    return { domain_key: DOMAIN_KEY, status: 'ok', exported_at: exportedAt, items_count: itemsCount, data: redactSensitiveFields(data) };
  } catch (err) {
    return { domain_key: DOMAIN_KEY, status: 'error', exported_at: exportedAt, error: err.message, data: null };
  } finally {
    if (shouldEnd && pool) {
      try { await pool.end(); } catch { /* ignore */ }
    }
  }
}
