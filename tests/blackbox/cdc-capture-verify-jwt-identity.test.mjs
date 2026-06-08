/**
 * Black-box tests for fix-cdc-capture-verify-jwt-identity.
 *
 * Drives the public `main` exports of pg-capture-enable (and supporting actions)
 * via their injected deps — no internal knowledge beyond the public function signature.
 *
 * bbx-cdc-missing-headers-pg-enable:   pg-capture-enable with no gateway headers → 401 UNAUTHORIZED, no DB write
 * bbx-cdc-missing-headers-pg-disable:  pg-capture-disable with no gateway headers → 401 UNAUTHORIZED
 * bbx-cdc-missing-headers-pg-list:     pg-capture-list with no gateway headers → 401 UNAUTHORIZED
 * bbx-cdc-missing-headers-mongo-enable: mongo-capture-enable with no gateway headers → 401 UNAUTHORIZED, no DB write
 * bbx-cdc-forged-tenant:               forged unsigned JWT with ten_VICTIM as tenant_id must NOT be used;
 *                                       action uses the gateway-header tenant, NOT the JWT payload tenant
 * bbx-cdc-gateway-tenant-scope:        valid gateway headers → create record scoped to gateway tenant
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { main as pgEnable } from '../../services/provisioning-orchestrator/src/actions/realtime/pg-capture-enable.mjs';
import { main as pgDisable } from '../../services/provisioning-orchestrator/src/actions/realtime/pg-capture-disable.mjs';
import { main as pgList } from '../../services/provisioning-orchestrator/src/actions/realtime/pg-capture-list.mjs';
import { main as mongoEnable } from '../../services/provisioning-orchestrator/src/actions/realtime/mongo-capture-enable.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT_A = 'ten_CALLER_aaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WS_A = 'wrk_CALLER_aaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_VICTIM = 'ten_VICTIM_bbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const WS_VICTIM = 'wrk_VICTIM_bbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

/** Build a base64url-encoded unsigned JWT payload (header.payload — no signature) */
function forgeJwt(payload) {
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = encode({ alg: 'none', typ: 'JWT' });
  const body = encode(payload);
  return `${header}.${body}.`;
}

/** A fake configRepo that records create() calls */
function fakeConfigRepo(overrides = {}) {
  const creates = [];
  const finds = [];
  return {
    creates,
    finds,
    async create(attrs) {
      creates.push({ ...attrs });
      // Return a minimal CaptureConfig-like object (toJSON must work)
      const record = {
        id: 'cap-test-001',
        tenant_id: attrs.tenant_id,
        workspace_id: attrs.workspace_id,
        data_source_ref: attrs.data_source_ref,
        schema_name: attrs.schema_name ?? 'public',
        table_name: attrs.table_name,
        status: 'active',
        actor_identity: attrs.actor_identity,
        activation_ts: new Date().toISOString(),
        deactivation_ts: null,
        last_error: null,
        lsn_start: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        toJSON() { return { ...this }; },
      };
      return record;
    },
    async findByWorkspace(tenantId, workspaceId, status) {
      finds.push({ tenantId, workspaceId, status });
      return [];
    },
    async findById(tenantId, workspaceId, id) {
      finds.push({ tenantId, workspaceId, id });
      return null;
    },
  };
}

function fakeQuotaRepo() {
  return {
    async getQuota() { return null; },          // use env default
    async countActive() { return 0; },           // always under quota
  };
}

function fakeAuditRepo() {
  return { async append() {} };
}

function fakePublisher() {
  return { async publish() {} };
}

// ---------------------------------------------------------------------------
// Scenario 1 — Missing gateway identity headers → 401, no DB write
// ---------------------------------------------------------------------------

// bbx-cdc-missing-headers-pg-enable
test('bbx-cdc-missing-headers-pg-enable: pg-capture-enable without gateway headers returns 401 UNAUTHORIZED with no DB write', async () => {
  const configRepo = fakeConfigRepo();
  const result = await pgEnable(
    {
      __ow_headers: {
        // deliberately no x-tenant-id / x-workspace-id
        authorization: `Bearer ${forgeJwt({ tenant_id: TENANT_A, workspace_id: WS_A, sub: 'user:a' })}`,
      },
      data_source_ref: 'db1',
      table_name: 'orders',
    },
    {
      configRepo,
      quotaRepo: fakeQuotaRepo(),
      auditRepo: fakeAuditRepo(),
      publisher: fakePublisher(),
    },
  );

  assert.equal(result.statusCode, 401, `expected 401, got ${result.statusCode}`);
  assert.equal(result.body?.code, 'UNAUTHORIZED', `expected code UNAUTHORIZED, got ${result.body?.code}`);
  assert.equal(configRepo.creates.length, 0, `expected no DB creates, got ${configRepo.creates.length}`);
});

// bbx-cdc-missing-headers-pg-disable
test('bbx-cdc-missing-headers-pg-disable: pg-capture-disable without gateway headers returns 401 UNAUTHORIZED', async () => {
  const configRepo = fakeConfigRepo();
  const result = await pgDisable(
    {
      __ow_headers: {},
      captureId: 'cap-test-001',
    },
    {
      configRepo,
      auditRepo: fakeAuditRepo(),
      publisher: fakePublisher(),
    },
  );

  assert.equal(result.statusCode, 401, `expected 401, got ${result.statusCode}`);
  assert.equal(result.body?.code, 'UNAUTHORIZED', `expected code UNAUTHORIZED, got ${result.body?.code}`);
});

// bbx-cdc-missing-headers-pg-list
test('bbx-cdc-missing-headers-pg-list: pg-capture-list without gateway headers returns 401 UNAUTHORIZED', async () => {
  const configRepo = fakeConfigRepo();
  const result = await pgList(
    {
      __ow_headers: {},
    },
    { configRepo },
  );

  assert.equal(result.statusCode, 401, `expected 401, got ${result.statusCode}`);
  assert.equal(result.body?.code, 'UNAUTHORIZED', `expected code UNAUTHORIZED, got ${result.body?.code}`);
  assert.equal(configRepo.finds.length, 0, `expected no DB reads, got ${configRepo.finds.length}`);
});

// bbx-cdc-missing-headers-mongo-enable
test('bbx-cdc-missing-headers-mongo-enable: mongo-capture-enable without gateway headers returns 401 UNAUTHORIZED with no DB write', async () => {
  const configRepo = fakeConfigRepo();
  const result = await mongoEnable(
    {
      __ow_headers: {},
      data_source_ref: 'mongodb1',
      database_name: 'appdb',
      collection_name: 'events',
    },
    {
      configRepo,
      quotaRepo: fakeQuotaRepo(),
      auditRepo: fakeAuditRepo(),
      publisher: fakePublisher(),
      collectionProbe: async () => ({ ok: true, replicaSet: true }),
    },
  );

  assert.equal(result.statusCode, 401, `expected 401, got ${result.statusCode}`);
  assert.equal(result.body?.code, 'UNAUTHORIZED', `expected code UNAUTHORIZED, got ${result.body?.code}`);
  assert.equal(configRepo.creates.length, 0, `expected no DB creates, got ${configRepo.creates.length}`);
});

// ---------------------------------------------------------------------------
// Scenario 2 — Forged JWT tenant is IGNORED; gateway headers are authoritative
// (bbx-cdc-forged-tenant)
// ---------------------------------------------------------------------------

test('bbx-cdc-forged-tenant: forged unsigned JWT with ten_VICTIM as tenant_id must NOT scope the create to the victim tenant', async () => {
  const configRepo = fakeConfigRepo();

  // Attacker: forged JWT claims ten_VICTIM but gateway headers inject ten_CALLER
  const forgedToken = forgeJwt({
    tenant_id: TENANT_VICTIM,
    workspace_id: WS_VICTIM,
    sub: 'attacker',
  });

  const result = await pgEnable(
    {
      __ow_headers: {
        authorization: `Bearer ${forgedToken}`,
        // Gateway injects the REAL caller identity:
        'x-tenant-id': TENANT_A,
        'x-workspace-id': WS_A,
        'x-auth-subject': 'user:attacker',
      },
      data_source_ref: 'db1',
      table_name: 'orders',
    },
    {
      configRepo,
      quotaRepo: fakeQuotaRepo(),
      auditRepo: fakeAuditRepo(),
      publisher: fakePublisher(),
    },
  );

  // Must NOT return 401 — caller has valid gateway headers
  assert.notEqual(result.statusCode, 401, 'caller with valid gateway headers must not get 401');

  // The created record must be scoped to TENANT_A, never TENANT_VICTIM
  assert.equal(configRepo.creates.length, 1, 'expected exactly one DB create');
  const created = configRepo.creates[0];
  assert.equal(
    created.tenant_id,
    TENANT_A,
    `expected tenant_id ${TENANT_A} (from gateway header), got ${created.tenant_id}`,
  );
  assert.equal(
    created.workspace_id,
    WS_A,
    `expected workspace_id ${WS_A} (from gateway header), got ${created.workspace_id}`,
  );
  assert.notEqual(
    created.tenant_id,
    TENANT_VICTIM,
    'tenant_id must NEVER be the forged victim tenant',
  );

  // Response must NOT be scoped to victim
  if (result.statusCode === 201 && result.body?.tenant_id) {
    assert.notEqual(
      result.body.tenant_id,
      TENANT_VICTIM,
      'response body tenant_id must NOT be ten_VICTIM',
    );
  }
});

// ---------------------------------------------------------------------------
// Scenario 3 — Valid gateway headers → create scoped to gateway tenant
// ---------------------------------------------------------------------------

test('bbx-cdc-gateway-tenant-scope: pg-capture-enable with valid gateway headers creates record scoped to that tenant', async () => {
  const configRepo = fakeConfigRepo();

  const result = await pgEnable(
    {
      __ow_headers: {
        'x-tenant-id': TENANT_A,
        'x-workspace-id': WS_A,
        'x-auth-subject': 'user:a',
      },
      data_source_ref: 'db1',
      table_name: 'orders',
    },
    {
      configRepo,
      quotaRepo: fakeQuotaRepo(),
      auditRepo: fakeAuditRepo(),
      publisher: fakePublisher(),
    },
  );

  assert.equal(result.statusCode, 201, `expected 201, got ${result.statusCode}`);
  assert.equal(configRepo.creates.length, 1, 'expected exactly one DB create');
  const created = configRepo.creates[0];
  assert.equal(created.tenant_id, TENANT_A, `DB create must use TENANT_A, got ${created.tenant_id}`);
  assert.equal(created.workspace_id, WS_A, `DB create must use WS_A, got ${created.workspace_id}`);

  // Response body should reflect the gateway-provided tenant
  assert.equal(result.body?.tenant_id, TENANT_A, `response body tenant_id must be ${TENANT_A}`);
  assert.equal(result.body?.workspace_id, WS_A, `response body workspace_id must be ${WS_A}`);
});
