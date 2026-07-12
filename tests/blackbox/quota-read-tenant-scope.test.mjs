/**
 * Black-box tests for change fix-quota-read-tenant-scope (#552, ISO-QUOTA-READ).
 *
 * GET /v1/tenants/{id}/quota/effective-limits and /quota/audit dispatch (kind + product) directly
 * to these provisioning-orchestrator actions. Their own-tenant guard checked ONLY the canonical
 * hyphen actor type `tenant-owner`, but the kind control-plane presents the underscore form
 * (`tenant_owner`) — so the guard silently no-op'd and a tenant operator read ANOTHER tenant's
 * quota (200). Non-owner/non-superadmin callers were not guarded at all.
 *
 * The fix adopts the sibling actions' default-deny `authorize` idiom: superadmin/internal → any
 * tenant; tenant-owner (both `tenant_owner`/`tenant-owner`/`tenant` forms) → own tenant only;
 * everyone else → 403.
 *
 * Drives the product actions' public `main()` with a synthetic callerContext + trivial db stub
 * (own-tenant positives resolve to an empty 200; cross-tenant is rejected before any data).
 *
 * bbx-quota-scope-01 .. bbx-quota-scope-08
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { main as effectiveLimits } from '../../packages/provisioning-orchestrator/src/actions/quota-effective-limits-get.mjs';
import { main as auditQuery } from '../../packages/provisioning-orchestrator/src/actions/quota-audit-query.mjs';

const fakeDb = { query: async () => ({ rows: [] }) };
const actor = (type, tenantId) => ({ callerContext: { actor: { id: 'op', type, tenantId } } });
const is403 = (e) => e.statusCode === 403 && e.code === 'FORBIDDEN';

// ---- effective-limits ----
test('bbx-quota-scope-01: tenant_owner (underscore) reads ANOTHER tenant effective-limits → 403', async () => {
  await assert.rejects(() => effectiveLimits({ tenantId: 'tenant-b', ...actor('tenant_owner', 'tenant-a') }, { db: fakeDb }), is403);
});

test('bbx-quota-scope-02: tenant-owner (hyphen) reads ANOTHER tenant effective-limits → 403', async () => {
  await assert.rejects(() => effectiveLimits({ tenantId: 'tenant-b', ...actor('tenant-owner', 'tenant-a') }, { db: fakeDb }), is403);
});

test('bbx-quota-scope-03: tenant_owner reads OWN tenant effective-limits → 200', async () => {
  const r = await effectiveLimits({ tenantId: 'tenant-a', ...actor('tenant_owner', 'tenant-a') }, { db: fakeDb });
  assert.equal(r.statusCode, 200);
});

test('bbx-quota-scope-04: superadmin reads any tenant effective-limits → 200', async () => {
  const r = await effectiveLimits({ tenantId: 'tenant-b', ...actor('superadmin', null) }, { db: fakeDb });
  assert.equal(r.statusCode, 200);
});

test('bbx-quota-scope-05: a non-owner authenticated caller reads cross-tenant effective-limits → 403', async () => {
  await assert.rejects(() => effectiveLimits({ tenantId: 'tenant-b', ...actor('tenant_member', 'tenant-a') }, { db: fakeDb }), is403);
});

// ---- audit ----
test('bbx-quota-scope-06: tenant_owner (underscore) reads ANOTHER tenant quota audit → 403', async () => {
  await assert.rejects(() => auditQuery({ tenantId: 'tenant-b', ...actor('tenant_owner', 'tenant-a') }, { db: fakeDb }), is403);
});

test('bbx-quota-scope-07: tenant_owner reads OWN tenant quota audit → 200', async () => {
  const r = await auditQuery({ tenantId: 'tenant-a', ...actor('tenant_owner', 'tenant-a') }, { db: fakeDb });
  assert.equal(r.statusCode, 200);
});

test('bbx-quota-scope-08: superadmin reads any tenant quota audit → 200', async () => {
  const r = await auditQuery({ tenantId: 'tenant-b', ...actor('superadmin', null) }, { db: fakeDb });
  assert.equal(r.statusCode, 200);
});
