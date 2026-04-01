/**
 * PostgreSQL metadata seed for restore E2E tests.
 * @module tests/e2e/fixtures/restore/seed-postgres
 */

/**
 * @param {string} tenantId
 * @param {string} executionId
 * @param {'minimal'|'standard'|'conflicting'} level
 * @param {import('../../helpers/api-client.mjs').ApiClient} [client]
 * @param {Object} [overrides]
 * @returns {Promise<{ schemas: string[], tables: string[], views: string[] }>}
 */
export async function seedPostgres(tenantId, executionId, level = 'standard', client = null, overrides = {}) {
  const schemaName = `restore_${executionId.replace(/-/g, '_')}_1`;
  const schemas = [schemaName];
  const tables = [];
  const views = [];

  const tableCounts = { minimal: 1, standard: 3, conflicting: 3 };
  const count = tableCounts[level] ?? 3;

  for (let i = 1; i <= count; i++) {
    const tableName = `restore_tbl_${executionId.replace(/-/g, '_')}_${i}`;
    tables.push(tableName);
    if (overrides.createTable) {
      await overrides.createTable(tenantId, {
        schema: schemaName,
        name: tableName,
        columns: [
          { column_name: 'id', data_type: 'uuid' },
          { column_name: 'data', data_type: 'jsonb' },
        ],
      });
    }
  }

  if (level !== 'minimal') {
    const viewName = `restore_vw_${executionId.replace(/-/g, '_')}_1`;
    views.push(viewName);
    if (overrides.createView) {
      await overrides.createView(tenantId, { schema: schemaName, name: viewName });
    }
  }

  return { schemas, tables, views };
}
