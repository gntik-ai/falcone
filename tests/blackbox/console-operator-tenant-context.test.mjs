/**
 * Black-box regression suite for spec change fix-console-operator-tenant-context
 * (live E2E campaign 2026-06-18, finding #27 / GitHub issue #569, epic #546).
 *
 * Reproduces the two root causes:
 *   (1) Web-console context bootstrap calls GET /v1/tenants (superadmin-only) — operators
 *       get 403 → zero tenant context. Fix: non-superadmin users resolve tenants via
 *       GET /v1/tenants/{tenantId} (authenticated, own-scope).
 *   (2) My-plan panel calls /v1/tenant/plan/effective-entitlements and
 *       /v1/tenant/effective-capabilities which were missing from the control-plane route
 *       table → 404 for operators. Fix: add both routes (auth: tenant_owner).
 *
 * Drives the public interface (the real action modules) only — no internal knowledge.
 * No live database required: a fake db stub models the data-layer responses.
 *
 * Scenario coverage (capability: web-console / spec.md):
 *   bbx-coctx-01  tenant-effective-entitlements-get: tenant_owner resolves own tenant → 200
 *   bbx-coctx-02  tenant-effective-entitlements-get: superadmin without tenantId → TENANT_NOT_FOUND
 *   bbx-coctx-03  tenant-effective-entitlements-get: tenant_owner cross-tenant attempt → FORBIDDEN
 *   bbx-coctx-04  tenant-effective-capabilities-get: tenant_owner resolves own tenant → 200
 *   bbx-coctx-05  tenant-effective-capabilities-get: tenant_owner cross-tenant attempt → FORBIDDEN
 *   bbx-coctx-06  routes.mjs: /v1/tenant/plan/effective-entitlements route is declared
 *   bbx-coctx-07  routes.mjs: /v1/tenant/effective-capabilities route is declared
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as entitlementsGet from '../../packages/provisioning-orchestrator/src/actions/tenant-effective-entitlements-get.mjs';
import * as capabilitiesGet from '../../packages/provisioning-orchestrator/src/actions/tenant-effective-capabilities-get.mjs';
import { routes } from '../../apps/control-plane/routes.mjs';

// Minimal fake db: resolveUnifiedEntitlements + resolveEffectiveCapabilities need
// a live DB but here we only test that the authz layer resolves the tenantId
// correctly and passes it to the repository layer — so we intercept at the DB.
function makeEntitlementsDb(tenantId) {
  return {
    query: async (text, params) => {
      // tenant_plan_assignments lookup (getCurrent / resolveUnifiedEntitlements)
      if (/tenant_plan_assignments/i.test(text) || /effective_entitlements/i.test(text)) {
        if (params && params[0] !== tenantId) return { rows: [] };
        return {
          rows: [{
            tenant_id: tenantId,
            plan_id: 'pln-starter',
            plan_slug: 'starter',
            plan_display_name: 'Starter',
            plan_description: null,
            plan_status: 'active',
            effective_from: '2026-01-01T00:00:00.000Z',
            assigned_by: 'sa-1',
            assignment_metadata: {},
            capabilities: { storage: true, realtime: false },
            quota_dimensions: { storage_gb: 10 }
          }]
        };
      }
      // quota_dimension_catalog
      if (/quota_dimension_catalog/i.test(text) || /dimensions/i.test(text)) {
        return { rows: [{ dimensionKey: 'storage_gb', dimension_key: 'storage_gb', displayLabel: 'Storage GB', platform_default: 10, default_value: 10 }] };
      }
      // boolean_capability_catalog / capability_catalog
      if (/boolean_capability_catalog/i.test(text)) {
        return { rows: [{ capability_key: 'storage', display_label: 'Storage', description: 'Object storage capability', platform_default: true, is_active: true, sort_order: 0 }] };
      }
      // tenant_plan_adjustments (capability overrides)
      if (/tenant_plan_adjustments/i.test(text)) {
        return { rows: [] };
      }
      // plan_capabilities (per-plan capability settings)
      if (/plan_capabilities/i.test(text)) {
        return { rows: [{ capability_key: 'storage', enabled: true }] };
      }
      return { rows: [] };
    }
  };
}

// -------------------------------------------------------------------------
// bbx-coctx-01: tenant_owner resolves own tenant without cross-tenant access
// -------------------------------------------------------------------------
test('bbx-coctx-01: tenant-effective-entitlements-get: tenant_owner resolves own tenant and returns 200', async () => {
  const tenantId = 'ten-acme-001';
  const db = makeEntitlementsDb(tenantId);
  const callerContext = {
    actor: { id: 'usr-ops-1', type: 'tenant_owner', tenantId }
  };

  const res = await entitlementsGet.main({ callerContext }, { db });

  assert.equal(res.statusCode, 200,
    'tenant_owner calling own-tenant entitlements must return 200 (not 403)');
  assert.equal(res.body.tenantId, tenantId,
    'response must carry the operator own tenant id');
  assert.ok(Array.isArray(res.body.capabilities),
    'response must include capabilities array');
});

// -------------------------------------------------------------------------
// bbx-coctx-02: superadmin without tenantId → TENANT_NOT_FOUND
// -------------------------------------------------------------------------
test('bbx-coctx-02: tenant-effective-entitlements-get: superadmin without tenantId throws TENANT_NOT_FOUND', async () => {
  const db = makeEntitlementsDb('any-tenant');
  const callerContext = { actor: { id: 'sa-1', type: 'superadmin' } };

  await assert.rejects(
    () => entitlementsGet.main({ callerContext }, { db }),
    (e) => e.code === 'TENANT_NOT_FOUND' || e.statusCode === 404,
    'superadmin without tenantId param must get TENANT_NOT_FOUND'
  );
});

// -------------------------------------------------------------------------
// bbx-coctx-03: tenant_owner cross-tenant attempt → FORBIDDEN
// -------------------------------------------------------------------------
test('bbx-coctx-03: tenant-effective-entitlements-get: tenant_owner cross-tenant attempt is FORBIDDEN', async () => {
  const db = makeEntitlementsDb('ten-other');
  const callerContext = {
    actor: { id: 'usr-ops-1', type: 'tenant_owner', tenantId: 'ten-acme-001' }
  };

  await assert.rejects(
    () => entitlementsGet.main({ tenantId: 'ten-other', callerContext }, { db }),
    (e) => e.code === 'FORBIDDEN' || e.statusCode === 403,
    'tenant_owner must be forbidden from reading a different tenant\'s entitlements'
  );
});

// -------------------------------------------------------------------------
// bbx-coctx-04: tenant-effective-capabilities-get: tenant_owner → 200
// -------------------------------------------------------------------------
test('bbx-coctx-04: tenant-effective-capabilities-get: tenant_owner resolves own tenant and returns 200', async () => {
  const tenantId = 'ten-acme-001';
  const db = makeEntitlementsDb(tenantId);
  const callerContext = {
    actor: { id: 'usr-ops-1', type: 'tenant_owner', tenantId }
  };

  const res = await capabilitiesGet.main({ callerContext }, { db });

  assert.equal(res.statusCode, 200,
    'tenant_owner calling own-tenant capabilities must return 200');
  assert.ok(typeof res.body.capabilities === 'object',
    'response must include capabilities map');
  assert.equal(res.body.tenantId, tenantId,
    'response must echo the tenant id');
});

// -------------------------------------------------------------------------
// bbx-coctx-05: tenant-effective-capabilities-get: cross-tenant → FORBIDDEN
// -------------------------------------------------------------------------
test('bbx-coctx-05: tenant-effective-capabilities-get: tenant_owner cross-tenant attempt is FORBIDDEN', async () => {
  const db = makeEntitlementsDb('ten-other');
  const callerContext = {
    actor: { id: 'usr-ops-1', type: 'tenant_owner', tenantId: 'ten-acme-001' }
  };

  await assert.rejects(
    () => capabilitiesGet.main({ tenantId: 'ten-other', callerContext }, { db }),
    (e) => e.code === 'FORBIDDEN' || e.statusCode === 403,
    'tenant_owner must be forbidden from reading capabilities of a different tenant'
  );
});

// -------------------------------------------------------------------------
// bbx-coctx-06: routes.mjs declares /v1/tenant/plan/effective-entitlements
// -------------------------------------------------------------------------
test('bbx-coctx-06: routes.mjs declares GET /v1/tenant/plan/effective-entitlements with tenant_owner auth', () => {
  const route = routes.find(
    (r) => r.method === 'GET' && r.path === '/v1/tenant/plan/effective-entitlements'
  );

  assert.ok(route,
    'routes.mjs must declare GET /v1/tenant/plan/effective-entitlements (operators cannot call superadmin /v1/tenant/entitlements for plan context)');
  assert.equal(route.auth, 'tenant_owner',
    '/v1/tenant/plan/effective-entitlements must have auth:tenant_owner so operators can call it');
  assert.ok(route.module && route.module.includes('tenant-effective-entitlements-get'),
    'route must delegate to tenant-effective-entitlements-get action');
});

// -------------------------------------------------------------------------
// bbx-coctx-07: routes.mjs declares /v1/tenant/effective-capabilities
// -------------------------------------------------------------------------
test('bbx-coctx-07: routes.mjs declares GET /v1/tenant/effective-capabilities with tenant_owner auth', () => {
  const route = routes.find(
    (r) => r.method === 'GET' && r.path === '/v1/tenant/effective-capabilities'
  );

  assert.ok(route,
    'routes.mjs must declare GET /v1/tenant/effective-capabilities (console capabilities bootstrap 403s for operators without this route)');
  assert.equal(route.auth, 'tenant_owner',
    '/v1/tenant/effective-capabilities must have auth:tenant_owner so operators can call it');
  assert.ok(route.module && route.module.includes('tenant-effective-capabilities-get'),
    'route must delegate to tenant-effective-capabilities-get action');
});
