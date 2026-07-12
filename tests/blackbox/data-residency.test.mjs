/**
 * Black-box tests for add-data-residency-pinning (issue #272).
 *
 * Drives the public interface only:
 *   - apps/control-plane-executor/src/tenant-data-residency.mjs
 *       validateResidencyRegion(input)            — pure provisioning-input validation
 *       applyResidencyToTenantRecord(...)         — persist data_residency_region via injected db
 *       readTenantResidency(...)                  — read data_residency_region via injected db
 *       listSupportedRegions(params, overrides)   — GET /v1/platform/topology/regions handler
 *       enforceResidency({ tenant, requestedRegion, auditEmitter })
 *                                                 — control-plane cross-region enforcement
 *   - packages/internal-contracts/src/deployment-topology.mjs
 *       getSupportedRegions()                     — catalog derived from deployment-topology.json
 *   - the six provisioning appliers (iam/postgres/mongo/kafka/storage/functions)
 *       apply(tenantId, domainData, { regionRef })
 *
 * Every dependency is injected via overrides / fakes — no internal knowledge
 * beyond the public function signatures. No `jose` (kept out of the pre-existing
 * failing optional-dep surface).
 *
 * Scenario coverage (spec delta add-data-residency-pinning):
 *   valid region accepted + persisted + read back            (Tenant provisioned with a valid residency region)
 *   unsupported region rejected, no record created           (Tenant provisioned with an unsupported region is rejected)
 *   two tenants' regions isolated                            (Region selection is isolated per tenant)
 *   each of six appliers carries regionRef                   (All appliers target the pinned region)
 *   each of six appliers refuses an unsupported region       (Applier refuses to target a region not in the supported catalog)
 *   enforcement same-region pass-through, no event           (Request respecting the pinned region succeeds)
 *   enforcement cross-region 403 + residency_violation event (Cross-region request is rejected with a residency-violation event)
 *   enforcement null region pass-through, no event           (backward compatibility)
 *   regions endpoint returns the catalog                     (Platform topology endpoint lists supported regions)
 *   regions list reflects deployment-topology.json           (Regions list reflects the deployment-topology configuration)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateResidencyRegion,
  applyResidencyToTenantRecord,
  readTenantResidency,
  listSupportedRegions,
  enforceResidency,
} from '../../apps/control-plane-executor/src/tenant-data-residency.mjs';

import { getSupportedRegions } from '../../packages/internal-contracts/src/deployment-topology.mjs';

import { apply as applyIam } from '../../packages/provisioning-orchestrator/src/appliers/iam-applier.mjs';
import { apply as applyPostgres } from '../../packages/provisioning-orchestrator/src/appliers/postgres-applier.mjs';
import { apply as applyMongo } from '../../packages/provisioning-orchestrator/src/appliers/mongo-applier.mjs';
import { apply as applyKafka } from '../../packages/provisioning-orchestrator/src/appliers/kafka-applier.mjs';
import { apply as applyStorage } from '../../packages/provisioning-orchestrator/src/appliers/storage-applier.mjs';
import { apply as applyFunctions } from '../../packages/provisioning-orchestrator/src/appliers/functions-applier.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_A = 'ten_aaaaaaaaaaaa';
const TENANT_B = 'ten_bbbbbbbbbbbb';

// The catalog derived from deployment-topology.json today is exactly ["eu-west-1"].
const SUPPORTED = getSupportedRegions();
const VALID_REGION = SUPPORTED[0];          // "eu-west-1"
const UNSUPPORTED_REGION = 'ap-southeast-99';

/**
 * Two-virtual-region catalog used to exercise validation/enforcement paths that
 * require more than one region (per design.md test-fixture override). Validation
 * and enforcement accept an injected `supportedRegions` override so tests can
 * simulate a multi-region deployment without changing the contract file.
 */
const TWO_REGIONS = ['eu-west-1', 'us-east-1'];

/**
 * In-memory fake of the control-plane tenants store. Captures the persisted
 * data_residency_region so the test can assert exactly what was written. Mirrors
 * a minimal `query(text, values)` → { rows } interface plus a row map.
 */
function fakeTenantDb(seed = []) {
  const rows = new Map();
  for (const r of seed) rows.set(r.tenant_id, { ...r });
  const writes = [];
  return {
    rows,
    writes,
    async setResidency(tenantId, region) {
      writes.push({ tenant_id: tenantId, data_residency_region: region });
      const existing = rows.get(tenantId) ?? { tenant_id: tenantId };
      existing.data_residency_region = region;
      rows.set(tenantId, existing);
      return existing;
    },
    async getResidency(tenantId) {
      const row = rows.get(tenantId);
      return row ? row.data_residency_region ?? null : null;
    },
  };
}

// ---------------------------------------------------------------------------
// Requirement: Per-tenant data residency region selection
// ---------------------------------------------------------------------------

test('bbx-res-validate-valid: a supported region passes validation', () => {
  const result = validateResidencyRegion({ region: VALID_REGION });
  assert.equal(result.ok, true);
  assert.equal(result.region, VALID_REGION);
});

test('bbx-res-persist-read: valid region is persisted and read back', async () => {
  const db = fakeTenantDb([{ tenant_id: TENANT_A }]);
  const applied = await applyResidencyToTenantRecord(
    { tenantId: TENANT_A, region: VALID_REGION },
    { db },
  );
  assert.equal(applied.ok, true);
  // Exactly one write, carrying the chosen region.
  assert.equal(db.writes.length, 1);
  assert.deepEqual(db.writes[0], { tenant_id: TENANT_A, data_residency_region: VALID_REGION });

  const readBack = await readTenantResidency({ tenantId: TENANT_A }, { db });
  assert.equal(readBack.region, VALID_REGION);
});

test('bbx-res-unsupported-rejected: unsupported region → 400-class, NO record created', async () => {
  // Pure validation rejects.
  const v = validateResidencyRegion({ region: UNSUPPORTED_REGION });
  assert.equal(v.ok, false);
  assert.equal(v.statusCode, 400);
  assert.match(JSON.stringify(v.body), new RegExp(UNSUPPORTED_REGION));

  // And the persistence path refuses to write when the region is unsupported.
  const db = fakeTenantDb([{ tenant_id: TENANT_A }]);
  const applied = await applyResidencyToTenantRecord(
    { tenantId: TENANT_A, region: UNSUPPORTED_REGION },
    { db },
  );
  assert.equal(applied.ok, false);
  assert.equal(applied.statusCode, 400);
  assert.equal(db.writes.length, 0, 'no tenant record may be written for an unsupported region');
  assert.equal(await db.getResidency(TENANT_A), null);
});

test('bbx-res-isolation: two tenants pin different regions with no cross-bleed', async () => {
  const db = fakeTenantDb([{ tenant_id: TENANT_A }, { tenant_id: TENANT_B }]);

  await applyResidencyToTenantRecord(
    { tenantId: TENANT_A, region: 'eu-west-1' },
    { db, supportedRegions: TWO_REGIONS },
  );
  await applyResidencyToTenantRecord(
    { tenantId: TENANT_B, region: 'us-east-1' },
    { db, supportedRegions: TWO_REGIONS },
  );

  const a = await readTenantResidency({ tenantId: TENANT_A }, { db });
  const b = await readTenantResidency({ tenantId: TENANT_B }, { db });
  assert.equal(a.region, 'eu-west-1');
  assert.equal(b.region, 'us-east-1');
  assert.notEqual(a.region, b.region);
});

// ---------------------------------------------------------------------------
// Requirement: Provisioning appliers respect the tenant's pinned region
// ---------------------------------------------------------------------------

const APPLIERS = [
  ['iam', applyIam, { realm: TENANT_A, roles: [] }, { kcApi: async () => ({ ok: false, status: 404 }) }],
  ['postgres_metadata', applyPostgres, { schema: 'ten_a', schemas: [] }, { query: async () => [] }],
  ['mongo_metadata', applyMongo, { database: 'ten_a', collections: [] }, { getDb: () => ({}) }],
  ['kafka', applyKafka, { topics: [] }, { kafkaAdmin: {} }],
  ['storage', applyStorage, { buckets: [] }, { s3Api: {} }],
  ['functions', applyFunctions, { namespace: TENANT_A, packages: [] }, { owApi: async () => ({ ok: false, status: 404 }) }],
];

for (const [name, applyFn, domainData] of APPLIERS) {
  test(`bbx-res-applier-carries-region [${name}]: regionRef threaded into applier metadata`, async () => {
    const result = await applyFn(TENANT_A, domainData, { dryRun: true, regionRef: VALID_REGION });
    assert.equal(result.region_ref, VALID_REGION, `${name} applier must echo the pinned region in its result metadata`);
  });

  test(`bbx-res-applier-refuses-unsupported [${name}]: unsupported regionRef → error, no resource created`, async () => {
    let createdResource = false;
    const spyCreds = {
      // Any backend call would set this; refusal must happen before any I/O.
      kcApi: async () => { createdResource = true; return { ok: true, status: 201 }; },
      query: async () => { createdResource = true; return []; },
      getDb: () => { createdResource = true; return {}; },
      kafkaAdmin: { createTopics: async () => { createdResource = true; } },
      s3Api: { createBucket: async () => { createdResource = true; } },
      owApi: async () => { createdResource = true; return { ok: true, status: 200 }; },
    };
    await assert.rejects(
      () => applyFn(TENANT_A, domainData, { dryRun: false, regionRef: UNSUPPORTED_REGION, credentials: spyCreds }),
      (err) => {
        assert.equal(err.code, 'REGION_NOT_SUPPORTED', `${name} must throw a typed REGION_NOT_SUPPORTED error`);
        assert.match(err.message, new RegExp(UNSUPPORTED_REGION));
        return true;
      },
      `${name} applier must refuse an unsupported regionRef`,
    );
    assert.equal(createdResource, false, `${name} must not create any resource for an unsupported region`);
  });
}

// ---------------------------------------------------------------------------
// Requirement: Cross-region requests are rejected and audited
// ---------------------------------------------------------------------------

function recordingEmitter() {
  const events = [];
  return { events, emit: async (e) => { events.push(e); } };
}

test('bbx-res-enforce-same-region: same region → pass-through, NO residency_violation event', async () => {
  const emitter = recordingEmitter();
  const result = await enforceResidency({
    tenant: { tenantId: TENANT_A, dataResidencyRegion: 'eu-west-1' },
    requestedRegion: 'eu-west-1',
    auditEmitter: emitter,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.statusCode ?? 200, 200);
  assert.equal(emitter.events.length, 0, 'no event for an in-region request');
});

test('bbx-res-enforce-null-region: unpinned tenant → pass-through, NO event', async () => {
  const emitter = recordingEmitter();
  const result = await enforceResidency({
    tenant: { tenantId: TENANT_A, dataResidencyRegion: null },
    requestedRegion: 'us-east-1',
    auditEmitter: emitter,
  });
  assert.equal(result.allowed, true);
  assert.equal(emitter.events.length, 0, 'unpinned tenants are exempt (backward compatibility)');
});

test('bbx-res-enforce-cross-region: cross region → 403 RESIDENCY_VIOLATION + residency_violation event', async () => {
  const emitter = recordingEmitter();
  const result = await enforceResidency({
    tenant: { tenantId: TENANT_A, dataResidencyRegion: 'eu-west-1' },
    requestedRegion: 'us-east-1',
    auditEmitter: emitter,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.statusCode, 403);
  assert.equal(result.body.code, 'RESIDENCY_VIOLATION');

  assert.equal(emitter.events.length, 1, 'exactly one residency_violation event');
  const event = emitter.events[0];
  // Category aligns with the audit-pipeline subsystem roster addition.
  assert.equal(event.category, 'residency_violation');
  assert.equal(event.tenantId, TENANT_A);
  assert.equal(event.pinnedRegion, 'eu-west-1');
  assert.equal(event.requestedRegion, 'us-east-1');
});

// ---------------------------------------------------------------------------
// Requirement: Region availability is discoverable
// ---------------------------------------------------------------------------

test('bbx-res-regions-endpoint: GET /v1/platform/topology/regions returns the catalog', async () => {
  const result = await listSupportedRegions({}, {});
  assert.equal(result.statusCode, 200);
  assert.ok(Array.isArray(result.body.regions));
  assert.deepEqual(result.body.regions, getSupportedRegions());
});

test('bbx-res-regions-match-topology: endpoint reflects deployment-topology.json distinct region_ref values', async () => {
  // Today deployment-topology.json declares "eu-west-1" as the only region.
  assert.deepEqual(getSupportedRegions(), ['eu-west-1']);
  const result = await listSupportedRegions({}, {});
  assert.deepEqual(result.body.regions, ['eu-west-1']);
});
