// bbx-bkp-shared-row-isolation-01
//
// Black-box reproduction for issue #219 / change restrict-shared-backup-status-visibility.
// Drives the PUBLIC action main() from backup-status.action.js (ESM sibling of .ts).
// Injects a fake DB client via repository.js::setClient(...).
//
// IMPORTANT — module identity:
//   action.js statically imports repository.js. To share the same module instance,
//   both are imported with the same specifier (no query suffix). setClient() on the
//   shared module affects the getByTenant/getAll calls inside action.js.
//
// Scenarios covered:
//   S1 (PRE-FIX MUST FAIL): T1 caller with backup-status:read:technical (no platform scope)
//       queries tenant_id=T1 → BUG: also gets T2-owned shared rows via OR is_shared_instance = TRUE.
//       POST-FIX: response.components contains only T1 rows; T2 shared instance_id absent.
//   S2: platform caller with backup-status:read:shared-platform queries tenant_id=T1
//       → DOES receive the T2-owned shared row (platform behavior preserved).
//
// Fake DB semantics: mimics the real SQL WHERE branch semantics (inspects query text):
//   includeShared=true (OR is_shared_instance = TRUE):  tenant_id=$1 OR is_shared_instance
//   includeShared=false (AND is_shared_instance = FALSE): tenant_id=$1 AND NOT is_shared_instance

import test from 'node:test';
import assert from 'node:assert/strict';

// ---- Shared module imports (NO cache-busting — must match the specifiers in action.js) ----
// action.js imports '../db/repository.js' — from the test file that resolves to the same path.
import { setClient } from '../../services/backup-status/src/db/repository.js';
import { main } from '../../services/backup-status/src/api/backup-status.action.js';

// ---- Token builder (TEST_MODE) ------------------------------------------------
function makeToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.FAKESIG`;
}

// ---- Fixture rows ---------------------------------------------------------------
const T1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const T2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const now = new Date().toISOString();

// All rows in the "database"
const ALL_ROWS = [
  // T1 regular row
  {
    id: 'row-1',
    tenant_id: T1,
    component_type: 'postgresql',
    instance_id: 'db-t1',
    instance_label: 'T1 DB',
    deployment_profile: null,
    is_shared_instance: false,
    status: 'success',
    last_successful_backup_at: now,
    last_checked_at: now,
    detail: 'T1 detail',
    adapter_metadata: null,
    collected_at: now,
  },
  // T2 regular row
  {
    id: 'row-2',
    tenant_id: T2,
    component_type: 'postgresql',
    instance_id: 'db-t2',
    instance_label: 'T2 DB',
    deployment_profile: null,
    is_shared_instance: false,
    status: 'success',
    last_successful_backup_at: now,
    last_checked_at: now,
    detail: 'T2 detail',
    adapter_metadata: null,
    collected_at: now,
  },
  // T2-owned shared row (is_shared_instance=true, tenant_id=T2)
  {
    id: 'row-3',
    tenant_id: T2,
    component_type: 's3',
    instance_id: 'shared-s3-bucket',
    instance_label: 'Shared S3',
    deployment_profile: null,
    is_shared_instance: true,
    status: 'success',
    last_successful_backup_at: now,
    last_checked_at: now,
    detail: 'T2 shared detail - confidential',
    adapter_metadata: { owner: 'T2 internal metadata' },
    collected_at: now,
  },
];

// Fake DB client: mimics the two SQL WHERE branch semantics.
// Inspects the query text to decide which rows to return.
function makeFakeDb() {
  return {
    query(text, params) {
      const tenantId = params?.[0];
      let rows;
      if (text.includes('OR is_shared_instance = TRUE')) {
        // includeShared=true branch: tenant_id = $1 OR is_shared_instance = TRUE
        rows = ALL_ROWS.filter(r => r.tenant_id === tenantId || r.is_shared_instance === true);
      } else if (text.includes('AND is_shared_instance = FALSE')) {
        // includeShared=false branch: tenant_id = $1 AND is_shared_instance = FALSE
        rows = ALL_ROWS.filter(r => r.tenant_id === tenantId && r.is_shared_instance === false);
      } else if (text.includes('WHERE is_shared_instance = FALSE')) {
        rows = ALL_ROWS.filter(r => r.is_shared_instance === false);
      } else {
        rows = [...ALL_ROWS];
      }
      return Promise.resolve({ rows });
    },
  };
}

// ---- Tests -----------------------------------------------------------------------

// S1: T1 caller with read:technical but NO platform scope
//     PRE-FIX: leaks shared row from T2 (instance_id='shared-s3-bucket', tenant_id=T2)
//     POST-FIX: response.components must NOT include T2's shared instance_id
test('bbx-bkp-shared-row-isolation-01: T1 caller with read:technical leaks no T2 shared rows', async () => {
  process.env.TEST_MODE = 'true';
  delete process.env.NODE_ENV;
  delete process.env.KEYCLOAK_JWKS_URL;

  setClient(makeFakeDb());

  const token = makeToken({
    sub: 'user-t1',
    tenant_id: T1,
    scopes: ['backup-status:read:own', 'backup-status:read:technical'],
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  });

  const result = await main({
    __ow_method: 'get',
    __ow_headers: { authorization: `Bearer ${token}` },
    tenant_id: T1,
  });

  assert.equal(result.statusCode, 200, `Expected 200, got ${result.statusCode}: ${JSON.stringify(result.body)}`);
  const body = result.body;
  const instanceIds = body.components.map(c => c.instance_id).filter(Boolean);

  // Must NOT include T2's shared instance
  assert.ok(
    !instanceIds.includes('shared-s3-bucket'),
    `T1 caller must not see T2-owned shared row 'shared-s3-bucket', but got instance_ids: ${JSON.stringify(instanceIds)}`
  );

  // Must NOT include any component whose instance_id belongs to T2
  assert.ok(
    !instanceIds.includes('db-t2'),
    `T1 caller must not see T2's regular row 'db-t2', got: ${JSON.stringify(instanceIds)}`
  );

  // Must include T1's own row
  assert.ok(
    instanceIds.includes('db-t1'),
    `T1 caller should see own row 'db-t1', got: ${JSON.stringify(instanceIds)}`
  );
});

// S2: platform caller with backup-status:read:shared-platform
//     MUST still receive the T2-owned shared row (platform behavior preserved)
test('bbx-bkp-shared-row-isolation-01: platform caller with shared-platform scope receives T2 shared rows', async () => {
  process.env.TEST_MODE = 'true';
  delete process.env.NODE_ENV;
  delete process.env.KEYCLOAK_JWKS_URL;

  setClient(makeFakeDb());

  // Platform caller: has global scope + shared-platform scope
  const token = makeToken({
    sub: 'platform-admin',
    tenant_id: T1,
    scopes: [
      'backup-status:read:own',
      'backup-status:read:technical',
      'backup-status:read:global',
      'backup-status:read:shared-platform',
    ],
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  });

  const result = await main({
    __ow_method: 'get',
    __ow_headers: { authorization: `Bearer ${token}` },
    tenant_id: T1,
  });

  assert.equal(result.statusCode, 200, `Expected 200, got ${result.statusCode}: ${JSON.stringify(result.body)}`);
  const body = result.body;
  const instanceIds = body.components.map(c => c.instance_id).filter(Boolean);

  // Platform caller MUST see the T2-owned shared row
  assert.ok(
    instanceIds.includes('shared-s3-bucket'),
    `Platform caller should see shared row 'shared-s3-bucket', got: ${JSON.stringify(instanceIds)}`
  );
});
