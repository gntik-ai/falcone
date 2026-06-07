// Black-box test suite for change validate-reprovision-postgres-ddl.
// Drives the PUBLIC `apply` entrypoint only — fake query injected via credentials.
//
// Tests: bbx-pg-ddl-01 through bbx-pg-ddl-06
import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../../services/provisioning-orchestrator/src/appliers/postgres-applier.mjs';

const TENANT_ID = 'tenant-test-01';

/**
 * Build fake credentials.query that records every SQL call and returns []
 * (resources look non-existent → would trigger CREATE paths).
 */
function fakeCredentials() {
  const calls = [];
  return {
    calls,
    credentials: {
      async query(sql, params) {
        calls.push({ sql, params });
        return [];
      },
    },
  };
}

/** Helper: assert no DDL statement was issued */
function assertNoDDL(calls, label) {
  const ddl = calls.filter(c => /\b(CREATE|GRANT|ALTER|DROP)\b/i.test(c.sql));
  assert.equal(
    ddl.length,
    0,
    `${label}: expected NO DDL calls, but got ${ddl.length}: ${JSON.stringify(ddl.map(c => c.sql))}`,
  );
}

// bbx-pg-ddl-01: data_type outside allowlist (injection payload) → validation error, no DDL
test('bbx-pg-ddl-01: non-allowlist data_type is rejected before DDL execution', async () => {
  const { calls, credentials } = fakeCredentials();

  const domainData = {
    tables: [
      {
        name: 'evil_table',
        columns: [
          { name: 'col1', column_name: 'col1', data_type: 'text); DROP TABLE x; --', is_nullable: 'YES' },
        ],
      },
    ],
  };

  const result = await apply(TENANT_ID, domainData, { credentials });

  assert.equal(result.status, 'error', `expected status 'error', got '${result.status}'`);
  assert.ok(
    result.resource_results.some(r => r.action === 'error'),
    `expected at least one resource_result with action 'error', got: ${JSON.stringify(result.resource_results)}`,
  );
  assertNoDDL(calls, 'bbx-pg-ddl-01');
});

// bbx-pg-ddl-02: column_default with injection payload → validation error, no DDL
test('bbx-pg-ddl-02: injection payload in column_default is rejected before DDL execution', async () => {
  const { calls, credentials } = fakeCredentials();

  const domainData = {
    tables: [
      {
        name: 'evil_table',
        columns: [
          {
            name: 'col1',
            column_name: 'col1',
            data_type: 'text',
            column_default: "now(); DROP TABLE tenants; --",
            is_nullable: 'YES',
          },
        ],
      },
    ],
  };

  const result = await apply(TENANT_ID, domainData, { credentials });

  assert.equal(result.status, 'error', `expected status 'error', got '${result.status}'`);
  assert.ok(
    result.resource_results.some(r => r.action === 'error'),
    `expected at least one resource_result with action 'error'`,
  );
  assertNoDDL(calls, 'bbx-pg-ddl-02');
});

// bbx-pg-ddl-03: recognized types and safe defaults → provisions successfully (table created)
test('bbx-pg-ddl-03: standard types with safe defaults provisions table successfully', async () => {
  const { calls, credentials } = fakeCredentials();

  const domainData = {
    tables: [
      {
        name: 'safe_table',
        columns: [
          { name: 'id', column_name: 'id', data_type: 'uuid', column_default: 'gen_random_uuid()', is_nullable: 'NO' },
          { name: 'label', column_name: 'label', data_type: 'text', is_nullable: 'YES' },
          { name: 'count', column_name: 'count', data_type: 'integer', column_default: '0', is_nullable: 'NO' },
          { name: 'created_at', column_name: 'created_at', data_type: 'timestamp with time zone', column_default: 'now()', is_nullable: 'NO' },
        ],
      },
    ],
  };

  const result = await apply(TENANT_ID, domainData, { credentials });

  assert.equal(result.status, 'applied', `expected status 'applied', got '${result.status}'`);

  const createCalls = calls.filter(c => /\bCREATE TABLE\b/i.test(c.sql));
  assert.ok(createCalls.length > 0, `expected at least one CREATE TABLE call, got none. All calls: ${JSON.stringify(calls.map(c => c.sql))}`);
});

// bbx-pg-ddl-04: privilege_type outside fixed keyword set → validation error, no GRANT
test('bbx-pg-ddl-04: non-standard privilege_type is rejected before GRANT execution', async () => {
  const { calls, credentials } = fakeCredentials();

  const domainData = {
    grants: [
      {
        name: 'grant_evil',
        grantee: 'some_user',
        table_name: 'safe_table',
        privilege_type: 'SELECT; DROP TABLE x; --',
      },
    ],
  };

  const result = await apply(TENANT_ID, domainData, { credentials });

  assert.equal(result.status, 'error', `expected status 'error', got '${result.status}'`);
  assert.ok(
    result.resource_results.some(r => r.action === 'error'),
    `expected at least one resource_result with action 'error'`,
  );
  assertNoDDL(calls, 'bbx-pg-ddl-04');
});

// bbx-pg-ddl-05: recognized privilege_type SELECT → GRANT issued successfully
test('bbx-pg-ddl-05: recognized privilege_type SELECT issues GRANT successfully', async () => {
  const { calls, credentials } = fakeCredentials();

  const domainData = {
    grants: [
      {
        name: 'grant_select',
        grantee: 'readonly_user',
        table_name: 'safe_table',
        privilege_type: 'SELECT',
      },
    ],
  };

  const result = await apply(TENANT_ID, domainData, { credentials });

  assert.equal(result.status, 'applied', `expected status 'applied', got '${result.status}'`);

  const grantCalls = calls.filter(c => /\bGRANT\b/i.test(c.sql));
  assert.ok(grantCalls.length > 0, `expected at least one GRANT call, got none. All calls: ${JSON.stringify(calls.map(c => c.sql))}`);
});

// bbx-pg-ddl-06: views item with item.definition (tenant-controllable) → validation error, no CREATE OR REPLACE VIEW
test('bbx-pg-ddl-06: tenant-supplied view definition is rejected before CREATE OR REPLACE VIEW', async () => {
  const { calls, credentials } = fakeCredentials();

  const domainData = {
    views: [
      {
        name: 'evil_view',
        definition: 'SELECT 1; DROP TABLE tenants; --',
      },
    ],
  };

  const result = await apply(TENANT_ID, domainData, { credentials });

  assert.equal(result.status, 'error', `expected status 'error', got '${result.status}'`);
  assert.ok(
    result.resource_results.some(r => r.action === 'error'),
    `expected at least one resource_result with action 'error'`,
  );

  const viewDDL = calls.filter(c => /CREATE\s+OR\s+REPLACE\s+VIEW/i.test(c.sql));
  assert.equal(
    viewDDL.length,
    0,
    `expected NO CREATE OR REPLACE VIEW calls, but got ${viewDDL.length}: ${JSON.stringify(viewDDL.map(c => c.sql))}`,
  );
  assertNoDDL(calls, 'bbx-pg-ddl-06');
});
