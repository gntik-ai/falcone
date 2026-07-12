import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../actions/tenant-config-reprovision.mjs';

const defaultAuth = { actor_id: 'sre-1', actor_type: 'sre', scopes: ['platform:admin:config:reprovision'] };
const silentLog = { error: () => {}, warn: () => {}, info: () => {} };

function makeArtifact(tenantId = 'tenant-source') {
  return {
    tenant_id: tenantId,
    format_version: '1.0.0',
    domains: [
      { domain_key: 'iam', status: 'ok', data: { realm: tenantId, roles: [] } },
      { domain_key: 'postgres_metadata', status: 'ok', data: { schema: tenantId.replace(/-/g, '_'), tables: [] } },
      { domain_key: 'mongo_metadata', status: 'ok', data: { database: tenantId.replace(/-/g, '_'), collections: [] } },
      { domain_key: 'kafka', status: 'ok', data: { topics: [] } },
      { domain_key: 'functions', status: 'ok', data: { namespace: tenantId, actions: [] } },
      { domain_key: 'storage', status: 'ok', data: { buckets: [] } },
    ],
  };
}

function createOverrides(extra = {}) {
  const spies = { audit: [], publish: [], acquireLock: [], releaseLock: [], failLock: [] };
  return {
    overrides: {
      auth: defaultAuth,
      tenantExists: async () => true,
      isSameMajor: (a, b) => String(a).split('.')[0] === String(b).split('.')[0],
      getApplierRegistry: () => {
        const map = new Map();
        for (const dk of ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage']) {
          map.set(dk, async (tenantId, domainData, opts) => ({
            domain_key: dk,
            status: opts.dryRun ? 'would_apply' : 'applied',
            resource_results: [],
            counts: { created: 0, skipped: 0, conflicts: 0, errors: 0, warnings: 0 },
            message: null,
          }));
        }
        return map;
      },
      acquireLock: async (db, p) => { spies.acquireLock.push(p); return { lock_token: 'test-token', expires_at: new Date(Date.now() + 60000).toISOString() }; },
      releaseLock: async (db, p) => { spies.releaseLock.push(p); },
      failLock: async (db, p) => { spies.failLock.push(p); },
      insertReprovisionAuditLog: async (db, r) => { spies.audit.push(r); return { id: 'audit-1' }; },
      publishReprovisionCompleted: async (producer, p) => { spies.publish.push(p); return { published: false }; },
      db: {},
      log: silentLog,
      ...extra,
    },
    spies,
  };
}

// T-26 test cases

test('reprovision: no auth returns 403', async () => {
  const { overrides } = createOverrides({ auth: null });
  const result = await main({}, overrides);
  assert.equal(result.statusCode, 403);
});

test('reprovision: wrong scope returns 403 (no auth override)', async () => {
  // Without auth override, extracts from params — no token → 403
  const result = await main({}, { log: silentLog });
  assert.equal(result.statusCode, 403);
});

test('reprovision: tenant not found returns 404', async () => {
  const { overrides } = createOverrides({ tenantExists: async () => false });
  const result = await main({ tenant_id: 'missing', artifact: makeArtifact() }, overrides);
  assert.equal(result.statusCode, 404);
});

test('reprovision: incompatible format_version returns 422', async () => {
  const { overrides } = createOverrides();
  const artifact = makeArtifact();
  artifact.format_version = '2.0.0';
  const result = await main({ tenant_id: 'tenant-dest', artifact }, overrides);
  assert.equal(result.statusCode, 422);
});

test('reprovision: different tenant without identifier_map returns proposal (needs_confirmation)', async () => {
  const { overrides } = createOverrides();
  const artifact = makeArtifact('tenant-source');
  const result = await main({ tenant_id: 'tenant-dest', artifact }, overrides);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.needs_confirmation, true);
  assert.ok(result.body.proposal);
});

test('reprovision: invalid identifier_map returns 400', async () => {
  const { overrides } = createOverrides();
  const artifact = makeArtifact('tenant-source');
  const result = await main({
    tenant_id: 'tenant-dest',
    artifact,
    identifier_map: { entries: [{ from: 'abc', to: '' }] },
  }, overrides);
  assert.equal(result.statusCode, 400);
});

test('reprovision: unknown domain in filter returns 400', async () => {
  const { overrides } = createOverrides();
  const artifact = makeArtifact('tenant-dest');
  const result = await main({ tenant_id: 'tenant-dest', artifact, domains: ['unknown_domain'] }, overrides);
  assert.equal(result.statusCode, 400);
});

test('reprovision: lock held returns 409', async () => {
  const { overrides } = createOverrides({
    acquireLock: async () => { const err = new Error('locked'); err.code = 'LOCK_HELD'; throw err; },
  });
  const artifact = makeArtifact('tenant-dest');
  const result = await main({ tenant_id: 'tenant-dest', artifact }, overrides);
  assert.equal(result.statusCode, 409);
});

test('reprovision: happy path same tenant → 200 with all domains applied', async () => {
  const { overrides, spies } = createOverrides();
  const artifact = makeArtifact('tenant-dest');
  const result = await main({ tenant_id: 'tenant-dest', artifact }, overrides);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.result_status, 'success');
  assert.ok(result.body.domain_results.length > 0);
  assert.ok(spies.audit.length > 0, 'audit was called');
  assert.ok(spies.releaseLock.length > 0, 'lock was released');
});

test('reprovision: dry_run=true → result_status dry_run', async () => {
  const { overrides } = createOverrides();
  const artifact = makeArtifact('tenant-dest');
  const result = await main({ tenant_id: 'tenant-dest', artifact, dry_run: true }, overrides);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.result_status, 'dry_run');
  assert.equal(result.body.dry_run, true);
});

test('reprovision: one applier fails → 207 partial', async () => {
  const { overrides, spies } = createOverrides();
  let callCount = 0;
  overrides.getApplierRegistry = () => {
    const map = new Map();
    for (const dk of ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage']) {
      map.set(dk, async (tenantId, domainData, opts) => {
        callCount++;
        if (dk === 'iam') {
          return {
            domain_key: dk, status: 'error', resource_results: [],
            counts: { created: 0, skipped: 0, conflicts: 0, errors: 1, warnings: 0 },
            message: 'Keycloak unreachable',
          };
        }
        return {
          domain_key: dk, status: 'applied', resource_results: [],
          counts: { created: 1, skipped: 0, conflicts: 0, errors: 0, warnings: 0 },
          message: null,
        };
      });
    }
    return map;
  };
  const artifact = makeArtifact('tenant-dest');
  const result = await main({ tenant_id: 'tenant-dest', artifact }, overrides);
  assert.equal(result.statusCode, 207);
  assert.equal(result.body.result_status, 'partial');
});

test('reprovision: all appliers fail → 207 failed', async () => {
  const { overrides } = createOverrides();
  overrides.getApplierRegistry = () => {
    const map = new Map();
    for (const dk of ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage']) {
      map.set(dk, async () => ({
        domain_key: dk, status: 'error', resource_results: [],
        counts: { created: 0, skipped: 0, conflicts: 0, errors: 1, warnings: 0 },
        message: 'unavailable',
      }));
    }
    return map;
  };
  const artifact = makeArtifact('tenant-dest');
  const result = await main({ tenant_id: 'tenant-dest', artifact }, overrides);
  assert.equal(result.statusCode, 207);
  assert.equal(result.body.result_status, 'failed');
});

test('reprovision: audit is inserted', async () => {
  const { overrides, spies } = createOverrides();
  const artifact = makeArtifact('tenant-dest');
  await main({ tenant_id: 'tenant-dest', artifact }, overrides);
  assert.ok(spies.audit.length > 0);
  assert.equal(spies.audit[0].tenant_id, 'tenant-dest');
});

test('reprovision: kafka publish is called', async () => {
  const { overrides, spies } = createOverrides();
  const artifact = makeArtifact('tenant-dest');
  await main({ tenant_id: 'tenant-dest', artifact }, overrides);
  assert.ok(spies.publish.length > 0);
});

test('reprovision: lock is released after success', async () => {
  const { overrides, spies } = createOverrides();
  const artifact = makeArtifact('tenant-dest');
  await main({ tenant_id: 'tenant-dest', artifact }, overrides);
  assert.ok(spies.releaseLock.length > 0);
});
