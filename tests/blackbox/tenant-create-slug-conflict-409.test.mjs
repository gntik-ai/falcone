/**
 * Black-box regression suite for spec change fix-tenant-create-slug-conflict-409 (GitHub issue
 * #665, P18 data-layer consistency / uniqueness race · capability tenant-lifecycle).
 *
 * Defect (reproduced on live kind: N concurrent POST /v1/tenants with the SAME fresh slug ->
 * {201:1, 502:rest}): createTenant guards the slug with a `store.slugTaken` PRE-CHECK, but that read
 * is a TOCTOU — two concurrent racers both observe "free" and both proceed. The real atomicity
 * guarantee is the Postgres UNIQUE constraint `tenants_slug_key`; the loser's `insertTenant` throws
 * SQLSTATE 23505. The catch had NO 23505 mapping, so it returned
 *   502 { code: "CREATE_TENANT_FAILED", message: "duplicate key value violates unique constraint \"tenants_slug_key\"" }
 * leaking the raw PG text + constraint name + an inappropriate 5xx (a client conflict is a 409, and
 * a sequential duplicate already correctly returns 409 SLUG_TAKEN).
 *
 * Fix (the tenant twin of the proven workspace fix #634 in the SAME file): in createTenant's catch —
 * AFTER `saga.fail(e)` runs the durable compensations (so the loser's partial realm/client/owner-user
 * roll back) — map the unique-slug violation to the SAME clean 409 SLUG_TAKEN that the sequential
 * pre-check emits, instead of the raw-leaking 502. The generic 502 path is preserved for every other
 * failure (we did not over-broaden).
 *
 * This suite drives the REAL handler (apps/control-plane/b-handlers.mjs::createTenant)
 * deterministically by injecting store/kcAdmin/startSaga via ctx (the same `ctx.store ?? store`
 * seam issueCredential/rotateCredential already use) — no DB, no Keycloak. It encodes the
 * POST-TOCTOU mechanism the live race triggers (slugTaken returns false, then insert throws 23505):
 *   bbx-665-01  post-TOCTOU loser (slugTaken=false, insertTenant throws 23505) -> 409 SLUG_TAKEN,
 *               body carries NO raw PG text / constraint name / SQLSTATE; saga.fail() ran (Scenario)
 *   bbx-665-02  sequential duplicate (slugTaken=true) -> 409 SLUG_TAKEN, unchanged (control)
 *   bbx-665-03  a genuine NON-23505 failure -> still 502 CREATE_TENANT_FAILED (generic path preserved)
 *   bbx-665-04  a successful create -> 201 (happy path unchanged)
 *   bbx-665-05  a 23505 with a DIFFERENT/unrelated constraint -> still 502 (guard not over-broadened)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { LOCAL_HANDLERS } from '../../apps/control-plane/b-handlers.mjs';

// A pg-shaped unique-violation, exactly as node-postgres surfaces it for the slug constraint.
function pgUniqueViolation(constraint = 'tenants_slug_key') {
  return Object.assign(
    new Error(`duplicate key value violates unique constraint "${constraint}"`),
    { code: '23505', constraint, severity: 'ERROR', table: 'tenants' },
  );
}

// A fake durable-saga that records lifecycle calls and runs forward steps. step() awaits fn() and
// returns its value (so insertTenant's throw propagates to the handler catch, like the real Saga);
// fail()/complete() just record they ran. This lets us assert the loser's compensation path fired.
function fakeSaga() {
  const calls = { steps: [], failed: false, completed: false, failError: null };
  return {
    calls,
    saga: {
      runId: 'saga-test-1',
      async step(name, fn /*, compensation */) { calls.steps.push(name); return fn(); },
      async complete() { calls.completed = true; },
      async fail(error) { calls.failed = true; calls.failError = error; },
    },
  };
}

// Build a ctx for createTenant with injected deps. `insertBehavior` decides what insertTenant does:
//   'ok'           -> returns a tenant row (happy path)
//   Error instance -> thrown (loser path / generic failure)
// `slugTaken` toggles the sequential pre-check.
function buildCtx({ slugTaken = false, insertBehavior = 'ok' } = {}) {
  const fs = fakeSaga();
  const row = {
    id: 'ten-uuid-1', tenant_id: 'ten-uuid-1', slug: 'acme', display_name: 'Acme',
    status: 'active', iam_realm: 'ten-uuid-1', created_at: '2026-06-22T00:00:00Z', created_by: 'sa-1',
  };
  const store = {
    async slugTaken() { return slugTaken; },
    async insertTenant() {
      if (insertBehavior instanceof Error) throw insertBehavior;
      return row;
    },
  };
  // kcAdmin: every realm/client/user step is a no-op success so the saga reaches insertTenant.
  const kcAdmin = {
    async realmExists() { return false; },
    async createRealm() {},
    async createRealmRole() {},
    async createPublicAppClient() { return 'client-uuid-1'; },
    async addHardcodedClaimMapper() {},
    async createUser() { return 'user-1'; },
    async assignRealmRoles() {},
  };
  return {
    fs, row,
    ctx: {
      pool: {}, store, kcAdmin, startSaga: async () => fs.saga,
      identity: { sub: 'sa-1', actorType: 'superadmin' },
      body: { displayName: 'Acme', slug: 'acme' },
      callerContext: { correlationId: 'corr-1' },
    },
  };
}

// The response body must never carry the raw datastore failure text.
function bodyLeaksDatastore(body) {
  const s = JSON.stringify(body ?? {});
  return /duplicate key value/i.test(s) || /tenants_slug_key/i.test(s) || /23505/.test(s)
    || /constraint/i.test(s);
}

// -------------------------------------------------------------------------
// bbx-665-01: post-TOCTOU loser -> clean 409 SLUG_TAKEN, no raw PG leak, compensation ran (Scenario)
// -------------------------------------------------------------------------
test('bbx-665-01: post-TOCTOU loser (slugTaken=false then insert 23505) returns 409 SLUG_TAKEN with no raw PG/constraint/SQLSTATE leak (Scenario)', async () => {
  const h = buildCtx({ slugTaken: false, insertBehavior: pgUniqueViolation('tenants_slug_key') });
  const res = await LOCAL_HANDLERS.createTenant(h.ctx);

  assert.equal(res.statusCode, 409, 'a concurrent duplicate-slug race is a client conflict (409), not a 502');
  assert.equal(res.body.code, 'SLUG_TAKEN', 'race surfaces the SAME code as the sequential pre-check');
  assert.equal(res.body.message, "tenant slug 'acme' already exists", 'same clean message as the sequential collision');
  assert.equal(bodyLeaksDatastore(res.body), false, 'no raw PG text / constraint name / SQLSTATE is leaked');
  assert.ok(h.ctx.startSaga, 'sanity: saga was injected');
  assert.equal(h.fs.calls.failed, true, 'saga.fail() ran so the loser\'s partial realm/client/owner-user roll back');
  assert.equal(h.fs.calls.completed, false, 'the loser did not complete the saga');
  assert.ok(h.fs.calls.steps.includes('insertTenant'), 'the race reached the insert step (post-TOCTOU)');
});

// -------------------------------------------------------------------------
// bbx-665-02: sequential duplicate is unchanged (control)
// -------------------------------------------------------------------------
test('bbx-665-02: sequential duplicate (slugTaken=true) still returns 409 SLUG_TAKEN (unchanged)', async () => {
  const h = buildCtx({ slugTaken: true });
  const res = await LOCAL_HANDLERS.createTenant(h.ctx);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'SLUG_TAKEN');
  assert.equal(res.body.message, "tenant slug 'acme' already exists");
  assert.equal(h.fs.calls.steps.length, 0, 'the pre-check short-circuits before any saga step (no compensation needed)');
});

// -------------------------------------------------------------------------
// bbx-665-03: a genuine non-23505 failure still 502s (generic path preserved)
// -------------------------------------------------------------------------
test('bbx-665-03: a genuine non-23505 insert failure still returns 502 CREATE_TENANT_FAILED (generic path preserved)', async () => {
  const boom = Object.assign(new Error('connection terminated unexpectedly'), { code: '57P01' });
  const h = buildCtx({ slugTaken: false, insertBehavior: boom });
  const res = await LOCAL_HANDLERS.createTenant(h.ctx);

  assert.equal(res.statusCode, 502, 'a non-conflict server failure is still a 502, not a mislabeled 409');
  assert.equal(res.body.code, 'CREATE_TENANT_FAILED');
  assert.equal(h.fs.calls.failed, true, 'compensation still runs for a generic failure');
});

// -------------------------------------------------------------------------
// bbx-665-04: a successful create is unchanged (happy path)
// -------------------------------------------------------------------------
test('bbx-665-04: a successful create returns 201 (happy path unchanged)', async () => {
  const h = buildCtx({ slugTaken: false, insertBehavior: 'ok' });
  const res = await LOCAL_HANDLERS.createTenant(h.ctx);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.slug, 'acme');
  // iamRealm == the freshly generated tenantId (a UUID), per the Falcone realm-per-tenant model.
  assert.match(res.body.iamRealm, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.equal(h.fs.calls.completed, true, 'the winner completes the saga');
  assert.equal(h.fs.calls.failed, false, 'the winner does not compensate');
});

// -------------------------------------------------------------------------
// bbx-665-05: a 23505 on an UNRELATED constraint is NOT mislabeled as SLUG_TAKEN (guard breadth)
// -------------------------------------------------------------------------
test('bbx-665-05: a 23505 with a different constraint still returns 502 (guard is not over-broadened)', async () => {
  // Hypothetical future unique constraint unrelated to the slug — must NOT be reported as SLUG_TAKEN.
  const h = buildCtx({ slugTaken: false, insertBehavior: pgUniqueViolation('tenants_some_other_key') });
  const res = await LOCAL_HANDLERS.createTenant(h.ctx);

  assert.equal(res.statusCode, 502, 'only the slug constraint maps to 409; an unrelated 23505 stays a 502');
  assert.equal(res.body.code, 'CREATE_TENANT_FAILED');
});
