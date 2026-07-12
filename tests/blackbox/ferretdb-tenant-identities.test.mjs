/**
 * Black-box tests for add-ferretdb-tenant-isolation-credentials (#458).
 *
 * Drives the PUBLIC surface of the DocumentDB identity applier (provision/rotate/revoke)
 * via an injected fake wire-protocol client — no internal knowledge, no live engine. The
 * live-only assertions (the credential really is a non-superuser/non-BYPASSRLS Postgres
 * LOGIN role; the old password is rejected after rotation) live in the tests/env real-stack
 * slice + the kind E2E, NOT here.
 *
 * Per task 7.6: there is deliberately NO test asserting that Tenant A's credential is
 * REJECTED when reaching Tenant B's namespace at the engine layer — ADR-14 disproved that
 * at FerretDB v2.7.0, so such a test would be incorrect. Cross-tenant denial is enforced by
 * the app-layer filter, which the dual-isolation test below asserts is always applied.
 *
 * bbx-ferretdb-provision-once:   provision delivers a one-time credential exactly once
 * bbx-ferretdb-provision-idem:   idempotent re-provision delivers NO new credential
 * bbx-ferretdb-rotate-version:   rotation issues updateUser + bumps credentialVersion
 * bbx-ferretdb-revoke:           revocation issues dropUser; no-op when absent
 * bbx-ferretdb-failclosed:       engine error on createUser -> fail-closed throw
 * bbx-ferretdb-dual-isolation:   app-layer tenantId scoping is applied regardless of credential
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  provisionTenantIdentity,
  rotateTenantIdentityCredential,
  revokeTenantIdentity,
  DOCUMENTDB_IDENTITY_PROVISION_FAILED,
} from '../../packages/provisioning-orchestrator/src/appliers/documentdb-identity-applier.mjs';
import { applyTenantScopeToFilter } from '../../packages/adapters/src/mongodb-data-api.mjs';

const TENANT_A = 'ten_AAAA_aaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'ten_BBBB_bbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const quietLog = { info: () => {} };

// Fake FerretDB wire-protocol client. NOTE: the password literals it records are random
// base64url strings from node:crypto, never provider-shaped, so commits are not blocked
// by GitHub push protection (task 3.3).
function fakeWire({ existing = [], failOn = null } = {}) {
  const users = new Set(existing);
  const commands = [];
  return {
    commands,
    runCommand: async (dbName, command) => {
      commands.push({ dbName, command });
      const verb = Object.keys(command)[0];
      if (failOn === verb) throw new Error(`engine refused ${verb}`);
      if (command.usersInfo != null) return { users: users.has(command.usersInfo) ? [{ user: command.usersInfo }] : [] };
      if (command.createUser != null) { users.add(command.createUser); return { ok: 1 }; }
      if (command.dropUser != null) { users.delete(command.dropUser); return { ok: 1 }; }
      return { ok: 1 };
    },
  };
}

test('bbx-ferretdb-provision-once: provision delivers a one-time credential exactly once', async () => {
  const wire = fakeWire();
  const res = await provisionTenantIdentity(TENANT_A, { credentials: { runCommand: wire.runCommand }, log: quietLog });
  assert.equal(res.provisioned, true);
  assert.ok(res.oneTimeCredential, 'one-time credential envelope returned');
  assert.equal(res.oneTimeCredential.userName, res.userName);
  assert.ok(res.oneTimeCredential.password.length >= 40);
  assert.equal(wire.commands.filter((c) => c.command.createUser).length, 1);
});

test('bbx-ferretdb-provision-idem: idempotent re-provision delivers NO new credential', async () => {
  const wire = fakeWire({ existing: ['falcone_doc_ten_aaaa_aaaa_aaaa_aaaa_aaaa_aaaaaaaaaaaa'] });
  const res = await provisionTenantIdentity(TENANT_A, { credentials: { runCommand: wire.runCommand }, log: quietLog });
  assert.equal(res.provisioned, false);
  assert.equal(res.oneTimeCredential, null);
  assert.equal(wire.commands.filter((c) => c.command.createUser).length, 0);
});

test('bbx-ferretdb-rotate-version: rotation issues updateUser + bumps credentialVersion', async () => {
  const wire = fakeWire({ existing: ['x'] });
  const res = await rotateTenantIdentityCredential(TENANT_A, { credentials: { runCommand: wire.runCommand }, currentVersion: 3 });
  assert.equal(res.rotated, true);
  assert.equal(res.credentialVersion, 4);
  assert.ok(wire.commands.find((c) => c.command.updateUser));
  assert.notEqual(res.oneTimeCredential.password, undefined);
});

test('bbx-ferretdb-revoke: revocation issues dropUser; no-op when absent', async () => {
  const present = fakeWire({ existing: ['falcone_doc_ten_aaaa_aaaa_aaaa_aaaa_aaaa_aaaaaaaaaaaa'] });
  const r1 = await revokeTenantIdentity(TENANT_A, { credentials: { runCommand: present.runCommand }, log: quietLog });
  assert.equal(r1.revoked, true);
  assert.ok(present.commands.find((c) => c.command.dropUser));

  const absent = fakeWire();
  const r2 = await revokeTenantIdentity(TENANT_A, { credentials: { runCommand: absent.runCommand }, log: quietLog });
  assert.equal(r2.revoked, false);
  assert.equal(r2.alreadyAbsent, true);
  assert.equal(absent.commands.filter((c) => c.command.dropUser).length, 0);
});

test('bbx-ferretdb-failclosed: engine error on createUser -> fail-closed throw', async () => {
  const wire = fakeWire({ failOn: 'createUser' });
  await assert.rejects(
    provisionTenantIdentity(TENANT_A, { credentials: { runCommand: wire.runCommand }, log: quietLog }),
    (err) => err.code === DOCUMENTDB_IDENTITY_PROVISION_FAILED,
  );
});

test('bbx-ferretdb-dual-isolation: app-layer tenantId scoping is applied regardless of the per-tenant credential', () => {
  // The AUTHORITATIVE isolation boundary is the app-layer filter (mongodb-data-api.mjs),
  // not the credential. A query for Tenant A is scoped to A's tenantId; the same query
  // text issued for Tenant B is scoped to B's tenantId — independent of which credential
  // authenticated the connection. The scope is merged as a leading $and predicate.
  const aScoped = applyTenantScopeToFilter({ filter: { status: 'open' }, tenantId: TENANT_A });
  const bScoped = applyTenantScopeToFilter({ filter: { status: 'open' }, tenantId: TENANT_B });
  assert.equal(aScoped.tenantScope.value, TENANT_A);
  assert.equal(aScoped.tenantScope.injected, true);
  assert.deepEqual(aScoped.filter.$and?.[0], { tenantId: TENANT_A });
  assert.deepEqual(bScoped.filter.$and?.[0], { tenantId: TENANT_B });
  // A caller CANNOT override the tenant predicate by supplying a conflicting tenantId in
  // the filter — the app layer rejects it (403 tenant scope violation). This is what makes
  // app-layer scoping the authoritative boundary even though FerretDB v2.7.0 does not
  // enforce per-database role scoping (ADR-14).
  assert.throws(
    () => applyTenantScopeToFilter({ filter: { tenantId: TENANT_B, status: 'open' }, tenantId: TENANT_A }),
    (err) => err.code === 'mongo_data_tenant_scope_violation',
  );
});
