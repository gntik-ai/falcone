import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../../services/provisioning-orchestrator/src/actions/tenant-config-reprovision.mjs';

const defaultAuth = { actor_id: 'sre-1', actor_type: 'sre', scopes: ['platform:admin:config:reprovision'] };
const silentLog = { error: () => {}, warn: () => {}, info: () => {} };

function makeArtifact(tenantId = 'tenant-source', domainOverrides = {}) {
  return {
    tenant_id: tenantId,
    format_version: '1.0.0',
    domains: [
      { domain_key: 'iam', status: 'ok', data: { realm: tenantId, roles: [{ name: 'admin' }], groups: [], client_scopes: [], identity_providers: [], ...domainOverrides.iam } },
      { domain_key: 'postgres_metadata', status: 'ok', data: { schema: tenantId.replace(/-/g, '_'), schemas: [{ name: tenantId.replace(/-/g, '_') }], tables: [], views: [], extensions: [], grants: [], ...domainOverrides.postgres } },
      { domain_key: 'mongo_metadata', status: 'ok', data: { database: tenantId.replace(/-/g, '_'), collections: [{ name: 'events' }], indexes: [], ...domainOverrides.mongo } },
      { domain_key: 'kafka', status: 'ok', data: { topics: [{ name: `${tenantId}.events`, numPartitions: 3 }], acls: [], consumer_groups: [], ...domainOverrides.kafka } },
      { domain_key: 'functions', status: 'ok', data: { namespace: tenantId, actions: [{ name: 'hello', exec: { kind: 'nodejs:20' } }], packages: [], triggers: [], rules: [], ...domainOverrides.functions } },
      { domain_key: 'storage', status: 'ok', data: { buckets: [{ name: `${tenantId}-uploads` }], ...domainOverrides.storage } },
    ],
  };
}

/**
 * Create full mock applier registry that simulates empty target tenants.
 */
function createMockRegistry({ failDomains = [], existingResources = {} } = {}) {
  const writeCalls = [];
  return {
    writeCalls,
    getApplierRegistry: () => {
      const map = new Map();
      for (const dk of ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage']) {
        map.set(dk, async (tenantId, domainData, opts) => {
          if (failDomains.includes(dk)) {
            throw new Error(`${dk} subsystem unreachable`);
          }

          const resource_results = [];
          const counts = { created: 0, skipped: 0, conflicts: 0, errors: 0, warnings: 0 };

          // Simple simulation: iterate items from data and create/skip/conflict
          const items = _extractItems(dk, domainData);
          for (const item of items) {
            const existsInTarget = existingResources[`${dk}:${item.name}`];
            if (existsInTarget === 'same') {
              resource_results.push({ resource_type: dk, resource_name: item.name, resource_id: null, action: opts.dryRun ? 'would_skip' : 'skipped', message: null, warnings: [], diff: null });
              counts.skipped++;
            } else if (existsInTarget === 'different') {
              resource_results.push({ resource_type: dk, resource_name: item.name, resource_id: null, action: opts.dryRun ? 'would_conflict' : 'conflict', message: 'Config differs', warnings: [], diff: { field: { existing: 'a', desired: 'b' } } });
              counts.conflicts++;
            } else {
              if (!opts.dryRun) writeCalls.push({ domain: dk, resource: item.name });
              const hasRedacted = item.secret === '***REDACTED***' || Object.values(item).some(v => v === '***REDACTED***');
              const action = hasRedacted ? (opts.dryRun ? 'would_create' : 'applied_with_warnings') : (opts.dryRun ? 'would_create' : 'created');
              const warnings = hasRedacted ? ['Redacted field omitted'] : [];
              resource_results.push({ resource_type: dk, resource_name: item.name, resource_id: null, action, message: null, warnings, diff: null });
              counts.created++;
              if (hasRedacted) counts.warnings++;
            }
          }

          const hasWarnings = counts.warnings > 0;
          const status = counts.errors > 0 ? 'error'
            : hasWarnings ? (opts.dryRun ? 'would_apply_with_warnings' : 'applied_with_warnings')
            : counts.created > 0 ? (opts.dryRun ? 'would_apply' : 'applied')
            : (opts.dryRun ? 'would_skip' : 'skipped');

          return { domain_key: dk, status, resource_results, counts, message: null };
        });
      }
      return map;
    },
  };
}

function _extractItems(dk, data) {
  if (!data) return [];
  switch (dk) {
    case 'iam': return [...(data.roles ?? []), ...(data.groups ?? []), ...(data.client_scopes ?? []), ...(data.identity_providers ?? [])];
    case 'postgres_metadata': return [...(data.schemas ?? []), ...(data.tables ?? []), ...(data.views ?? []), ...(data.extensions ?? []), ...(data.grants ?? [])];
    case 'mongo_metadata': return [...(data.collections ?? []), ...(data.indexes ?? [])];
    case 'kafka': return [...(data.topics ?? []), ...(data.acls ?? [])];
    case 'functions': return [...(data.actions ?? []), ...(data.packages ?? []), ...(data.triggers ?? []), ...(data.rules ?? [])];
    case 'storage': return data.buckets ?? [];
    default: return [];
  }
}

function createOverrides(registryOverride, extra = {}) {
  const spies = { audit: [], publish: [], acquireLock: [], releaseLock: [] };
  return {
    overrides: {
      auth: defaultAuth,
      tenantExists: async () => true,
      isSameMajor: (a, b) => String(a).split('.')[0] === String(b).split('.')[0],
      ...registryOverride,
      acquireLock: async (db, p) => { spies.acquireLock.push(p); return { lock_token: 'test-token', expires_at: new Date(Date.now() + 60000).toISOString() }; },
      releaseLock: async (db, p) => { spies.releaseLock.push(p); },
      failLock: async () => {},
      insertReprovisionAuditLog: async (db, r) => { spies.audit.push(r); return { id: 'audit-1' }; },
      publishReprovisionCompleted: async (producer, p) => { spies.publish.push(p); return { published: false }; },
      db: {},
      log: silentLog,
      ...extra,
    },
    spies,
  };
}

// E2E Tests

test('E2E: happy path — all 6 domains applied on empty tenant', async () => {
  const registry = createMockRegistry();
  const { overrides, spies } = createOverrides(registry);
  const artifact = makeArtifact('tenant-dest');
  const result = await main({ tenant_id: 'tenant-dest', artifact }, overrides);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.result_status, 'success');
  assert.ok(result.body.domain_results.length >= 6);
  assert.ok(spies.audit.length > 0, 'audit written');
  assert.ok(spies.publish.length > 0, 'kafka event published');
  assert.ok(registry.writeCalls.length > 0, 'write operations occurred');
});

test('E2E: dry-run — no write operations, status dry_run', async () => {
  const registry = createMockRegistry();
  const { overrides } = createOverrides(registry);
  const artifact = makeArtifact('tenant-dest');
  const result = await main({ tenant_id: 'tenant-dest', artifact, dry_run: true }, overrides);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.result_status, 'dry_run');
  assert.equal(registry.writeCalls.length, 0, 'no write operations in dry-run');
});

test('E2E: domain filtering — only specified domains processed', async () => {
  const registry = createMockRegistry();
  const { overrides } = createOverrides(registry);
  const artifact = makeArtifact('tenant-dest');
  const result = await main({ tenant_id: 'tenant-dest', artifact, domains: ['iam', 'functions'] }, overrides);
  assert.equal(result.statusCode, 200);
  // Only iam and functions should have applied status
  const appliedDomains = result.body.domain_results.filter(d => d.status === 'applied' || d.status === 'applied_with_warnings');
  assert.ok(appliedDomains.every(d => ['iam', 'functions'].includes(d.domain_key)));
});

test('E2E: conflict detected — existing resource with different config', async () => {
  const registry = createMockRegistry({ existingResources: { 'iam:admin': 'different' } });
  const { overrides } = createOverrides(registry);
  const artifact = makeArtifact('tenant-dest');
  const result = await main({ tenant_id: 'tenant-dest', artifact }, overrides);
  const iamResult = result.body.domain_results.find(d => d.domain_key === 'iam');
  assert.ok(iamResult);
  const conflictResource = iamResult.resource_results.find(r => r.action === 'conflict');
  assert.ok(conflictResource, 'should have a conflict resource');
});

test('E2E: partial failure — one applier fails, others succeed', async () => {
  const registry = createMockRegistry({ failDomains: ['iam'] });
  const { overrides } = createOverrides(registry);
  const artifact = makeArtifact('tenant-dest');
  const result = await main({ tenant_id: 'tenant-dest', artifact }, overrides);
  assert.equal(result.statusCode, 207);
  assert.equal(result.body.result_status, 'partial');
  const iamResult = result.body.domain_results.find(d => d.domain_key === 'iam');
  assert.equal(iamResult.status, 'error');
});

test('E2E: concurrent lock — second request gets 409', async () => {
  const registry = createMockRegistry();
  const { overrides } = createOverrides(registry, {
    acquireLock: async () => { const err = new Error('locked'); err.code = 'LOCK_HELD'; throw err; },
  });
  const artifact = makeArtifact('tenant-dest');
  const result = await main({ tenant_id: 'tenant-dest', artifact }, overrides);
  assert.equal(result.statusCode, 409);
});

test('E2E: incompatible format_version → 422', async () => {
  const registry = createMockRegistry();
  const { overrides } = createOverrides(registry);
  const artifact = makeArtifact('tenant-dest');
  artifact.format_version = '2.0.0';
  const result = await main({ tenant_id: 'tenant-dest', artifact }, overrides);
  assert.equal(result.statusCode, 422);
});

test('E2E: redacted secrets — applied_with_warnings', async () => {
  const registry = createMockRegistry();
  const { overrides } = createOverrides(registry);
  const artifact = makeArtifact('tenant-dest', {
    functions: { actions: [{ name: 'hello', exec: { kind: 'nodejs:20' }, secret: '***REDACTED***' }], packages: [], triggers: [], rules: [] },
  });
  const result = await main({ tenant_id: 'tenant-dest', artifact }, overrides);
  const fnResult = result.body.domain_results.find(d => d.domain_key === 'functions');
  assert.ok(fnResult);
  const warningResource = fnResult.resource_results.find(r => r.warnings.length > 0);
  assert.ok(warningResource, 'should have a resource with warnings about redacted secrets');
});
