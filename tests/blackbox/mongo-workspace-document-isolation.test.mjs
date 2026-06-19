/**
 * Black-box tests for fix-document-store-workspace-isolation (#632).
 *
 * The document data plane isolates by `tenantId` ONLY — two workspaces (project/stage,
 * e.g. dev vs prod) of the SAME tenant that share a db+collection name share documents
 * (cross-workspace leak within a tenant). The SQL plane (per-workspace `wsdb_*` db) and
 * storage plane (per-workspace bucket) both isolate per workspace; the document plane is
 * the outlier. These tests drive the PURE adapter chokepoint that IS the isolation
 * boundary (services/adapters/src/mongodb-data-api.mjs) — `buildMongoDataApiPlan` builds
 * the filter/stamp, the executor merely dispatches it — so no live FerretDB is needed.
 *
 * The fix: inject `workspaceId` (in addition to `tenantId`) into every query filter and
 * stamp it onto every written document, so a doc written in one workspace is never
 * readable/updatable/deletable from another workspace of the same tenant.
 *
 * bbx-632-01: list  — filter is scoped by BOTH tenantId AND workspaceId
 * bbx-632-02: insert — document is stamped with BOTH tenantId AND workspaceId
 * bbx-632-03: cross-workspace — a prod-written doc does NOT match a staging read filter
 *             (same tenant); a different tenant is still excluded (tenant boundary intact)
 * bbx-632-04: get/update/replace/delete by id — filter carries the workspaceId predicate
 * bbx-632-05: a forged workspaceId in the document payload is rejected (403)
 * bbx-632-06: applyTenantScopeToFilter exposes the workspace scope and rejects a
 *             conflicting workspaceId predicate in the filter
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMongoDataApiPlan,
  applyTenantScopeToFilter,
  MongoDataApiError,
} from '../../services/adapters/src/mongodb-data-api.mjs';

const TENANT_ACME = 'ten_acme_0000-0000-0000-0000-000000000001';
const TENANT_GLOBEX = 'ten_glbx_0000-0000-0000-0000-000000000002';
const WS_PROD = 'wrk_app_prod';
const WS_STAGING = 'wrk_app_staging';

// Collect every `field: value` equality predicate reachable through nested $and/$or so a
// test can assert a predicate is present anywhere in the (possibly nested) scoped filter.
function collectEqualities(node, out = {}) {
  if (!node || typeof node !== 'object') return out;
  for (const [key, value] of Object.entries(node)) {
    if ((key === '$and' || key === '$or') && Array.isArray(value)) {
      for (const entry of value) collectEqualities(entry, out);
    } else if (value !== null && typeof value !== 'object') {
      out[key] = value;
    } else if (value && typeof value === 'object' && '$eq' in value) {
      out[key] = value.$eq;
    }
  }
  return out;
}

// A document "matches" a Mongo filter for the simple equality predicates we build here.
function docMatchesFilter(doc, filter) {
  return Object.entries(collectEqualities(filter)).every(([k, v]) => doc[k] === v);
}

const base = (overrides) => ({
  databaseName: 'capiso',
  collectionName: 'c1',
  ...overrides,
});

test('bbx-632-01: list filter is scoped by BOTH tenantId AND workspaceId', () => {
  const plan = buildMongoDataApiPlan(base({
    operation: 'list',
    workspaceId: WS_PROD,
    tenantId: TENANT_ACME,
    filter: { status: 'open' },
  }));
  const eq = collectEqualities(plan.query.filter);
  assert.equal(eq.tenantId, TENANT_ACME, 'tenantId predicate present');
  assert.equal(eq.workspaceId, WS_PROD, 'workspaceId predicate present');
  assert.equal(eq.status, 'open', 'caller field filter preserved');
});

test('bbx-632-02: insert stamps BOTH tenantId AND workspaceId on the document', () => {
  const plan = buildMongoDataApiPlan(base({
    operation: 'insert',
    workspaceId: WS_PROD,
    tenantId: TENANT_ACME,
    payload: { document: { marker: 'ISO-X', where: 'prod' } },
  }));
  assert.equal(plan.write.document.tenantId, TENANT_ACME);
  assert.equal(plan.write.document.workspaceId, WS_PROD, 'workspaceId stamped on inserted doc');
});

test('bbx-632-03: a prod-written doc does not match a staging read of the same tenant; other tenant excluded', () => {
  // Document as it would be persisted by an insert in workspace `prod`.
  const prodDoc = buildMongoDataApiPlan(base({
    operation: 'insert',
    workspaceId: WS_PROD,
    tenantId: TENANT_ACME,
    payload: { document: { marker: 'ISO-X' } },
  })).write.document;

  // Read filter built for workspace `staging`, SAME tenant.
  const stagingRead = buildMongoDataApiPlan(base({
    operation: 'list',
    workspaceId: WS_STAGING,
    tenantId: TENANT_ACME,
  })).query.filter;
  assert.equal(docMatchesFilter(prodDoc, stagingRead), false,
    'staging read must NOT match the prod-written document (cross-workspace leak)');

  // Read filter for the SAME workspace returns it (no over-scoping).
  const prodRead = buildMongoDataApiPlan(base({
    operation: 'list',
    workspaceId: WS_PROD,
    tenantId: TENANT_ACME,
  })).query.filter;
  assert.equal(docMatchesFilter(prodDoc, prodRead), true, 'self-workspace read still matches');

  // A different tenant is excluded regardless of workspace (tenant boundary intact).
  const globexRead = buildMongoDataApiPlan(base({
    operation: 'list',
    workspaceId: WS_PROD,
    tenantId: TENANT_GLOBEX,
  })).query.filter;
  assert.equal(docMatchesFilter(prodDoc, globexRead), false, 'cross-tenant read excluded');
});

test('bbx-632-04: get/update/replace/delete by id carry the workspaceId predicate', () => {
  for (const op of ['get', 'delete']) {
    const plan = buildMongoDataApiPlan(base({ operation: op, workspaceId: WS_STAGING, tenantId: TENANT_ACME, documentId: 'doc1' }));
    const eq = collectEqualities(plan.query.filter);
    assert.equal(eq.workspaceId, WS_STAGING, `${op} filter scoped by workspaceId`);
    assert.equal(eq.tenantId, TENANT_ACME, `${op} filter scoped by tenantId`);
  }
  const upd = buildMongoDataApiPlan(base({ operation: 'update', workspaceId: WS_STAGING, tenantId: TENANT_ACME, documentId: 'doc1', payload: { update: { $set: { x: 1 } } } }));
  assert.equal(collectEqualities(upd.query.filter).workspaceId, WS_STAGING, 'update filter scoped by workspaceId');
  const rep = buildMongoDataApiPlan(base({ operation: 'replace', workspaceId: WS_STAGING, tenantId: TENANT_ACME, documentId: 'doc1', payload: { document: { x: 1 } } }));
  assert.equal(collectEqualities(rep.query.filter).workspaceId, WS_STAGING, 'replace filter scoped by workspaceId');
  assert.equal(rep.write.replacement.workspaceId, WS_STAGING, 'replacement stamped with workspaceId');
});

test('bbx-632-05: a forged workspaceId in the document payload is rejected (403)', () => {
  assert.throws(
    () => buildMongoDataApiPlan(base({
      operation: 'insert',
      workspaceId: WS_PROD,
      tenantId: TENANT_ACME,
      payload: { document: { marker: 'x', workspaceId: WS_STAGING } },
    })),
    (err) => err instanceof MongoDataApiError && err.status === 403 && err.code === 'mongo_data_tenant_scope_violation',
  );
});

test('bbx-632-06: applyTenantScopeToFilter exposes the workspace scope and rejects a conflicting workspace predicate', () => {
  const scoped = applyTenantScopeToFilter({ filter: { status: 'open' }, tenantId: TENANT_ACME, workspaceId: WS_PROD });
  assert.equal(scoped.tenantScope.value, TENANT_ACME);
  assert.equal(scoped.tenantScope.workspace.value, WS_PROD, 'workspace scope is exposed on tenantScope');
  const eq = collectEqualities(scoped.filter);
  assert.equal(eq.tenantId, TENANT_ACME);
  assert.equal(eq.workspaceId, WS_PROD);

  // A caller cannot override the workspace predicate via a conflicting filter value.
  assert.throws(
    () => applyTenantScopeToFilter({ filter: { workspaceId: WS_STAGING, status: 'open' }, tenantId: TENANT_ACME, workspaceId: WS_PROD }),
    (err) => err instanceof MongoDataApiError && err.code === 'mongo_data_tenant_scope_violation',
  );

  // Tenant-only call (no workspaceId) stays unchanged: no workspace scope, tenant-only filter.
  const tenantOnly = applyTenantScopeToFilter({ filter: { status: 'open' }, tenantId: TENANT_ACME });
  assert.equal(tenantOnly.tenantScope.workspace, undefined, 'no workspace scope when workspaceId omitted');
  assert.deepEqual(tenantOnly.filter.$and?.[0], { tenantId: TENANT_ACME });
});
