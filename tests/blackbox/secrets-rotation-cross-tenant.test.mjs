// bbx-secrets-rotation-cross-tenant-01
//
// Black-box reproduction for bug-001 / change bind-secret-rotation-to-authorized-tenant.
// Drives the PUBLIC action entrypoints (`main`) only. A `tenant-owner` of tenant A
// authorizes with its own tenantId (so the role gate passes) but operates on a
// `secretPath` owned by tenant B. The rotation MUST be rejected (403) BEFORE any
// Vault side effect. A same-tenant rotation MUST still succeed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { main as initiate } from '../../packages/provisioning-orchestrator/src/actions/secret-rotation-initiate.mjs';
import { main as revoke } from '../../packages/provisioning-orchestrator/src/actions/secret-rotation-revoke.mjs';

const ownerA = { sub: 'user:a', roles: ['tenant-owner'], tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
const TENANT_A = ownerA.tenantId;
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function fakeDb() {
  return { calls: [], async query(sql) { this.calls.push(sql); return { rows: [] }; } };
}

// Full repo fake sufficient for initiate to reach the Vault write on the pre-fix path.
function initiateRepo() {
  return {
    async getActiveVersion() { return { id: 'v1', vault_version: 1 }; },
    async getGraceVersion() { return null; },
    async expireGraceVersion() {},
    async transitionToGrace() { return { grace_expires_at: '2026-03-31T00:00:00.000Z' }; },
    async insertSecretVersion() { return { id: 'row-1' }; },
    async insertRotationEvent() {},
    async updateSecretVersionVaultVersion() { return { id: 'row-1', vault_version: 2 }; },
    async listConsumers() { return []; },
    async insertPropagationEvent() { return { requested_at: '2026-03-31T00:00:00.000Z' }; }
  };
}

// Full repo fake sufficient for revoke to reach the Vault delete on the pre-fix path.
function revokeRepo() {
  return {
    async getVersionByVaultVersion() { return { id: 'target' }; },
    async getActiveVersion() { return { id: 'other-active' }; },
    async getGraceVersion() { return { id: 'other-grace' }; },
    async revokeVersion() {},
    async insertRotationEvent() {}
  };
}

test('bbx-secrets-rotation-cross-tenant-01: tenant A cannot rotate (initiate) tenant B secret', async () => {
  const vault = { writes: [], async writeSecret(path) { this.writes.push(path); return { data: { version: 2 } }; } };
  const result = await initiate({
    auth: ownerA,
    domain: 'tenant',
    tenantId: TENANT_A,                 // caller's own tenant — role gate passes
    secretPath: `tenant/${TENANT_B}/db-password`, // ...but operates on tenant B's path
    newValue: 'ciphertext',
    justification: 'rotate',
    db: fakeDb(),
    repo: initiateRepo(),
    vaultClient: vault,
    publishEvent: async () => {},
    triggerEsoRefresh: async () => {}
  });
  assert.equal(result?.error?.status, 403, 'cross-tenant initiate must be forbidden');
  assert.equal(vault.writes.length, 0, 'no Vault write may occur for a cross-tenant secretPath');
});

test('bbx-secrets-rotation-cross-tenant-01: tenant A cannot revoke tenant B secret version', async () => {
  const vault = { deletes: [], async deleteSecretVersion(path) { this.deletes.push(path); } };
  const result = await revoke({
    auth: ownerA,
    domain: 'tenant',
    tenantId: TENANT_A,
    secretPath: `tenant/${TENANT_B}/db-password`,
    vaultVersion: 1,
    justification: 'revoke',
    db: fakeDb(),
    repo: revokeRepo(),
    vaultClient: vault,
    publishEvent: async () => {}
  });
  assert.equal(result?.error?.status, 403, 'cross-tenant revoke must be forbidden');
  assert.equal(vault.deletes.length, 0, 'no Vault delete may occur for a cross-tenant secretPath');
});

test('bbx-secrets-rotation-cross-tenant-01: same-tenant rotation still succeeds', async () => {
  const vault = { writes: [], async writeSecret(path) { this.writes.push(path); return { data: { version: 2 } }; } };
  const result = await initiate({
    auth: ownerA,
    domain: 'tenant',
    tenantId: TENANT_A,
    secretPath: `tenant/${TENANT_A}/db-password`, // caller's OWN tenant path
    newValue: 'ciphertext',
    justification: 'rotate',
    db: fakeDb(),
    repo: initiateRepo(),
    vaultClient: vault,
    publishEvent: async () => {},
    triggerEsoRefresh: async () => {}
  });
  assert.equal(result?.error, undefined, 'same-tenant rotation must not be rejected');
  assert.equal(result?.vaultVersionNew, 2);
  assert.equal(vault.writes.length, 1, 'same-tenant rotation performs exactly one Vault write');
});
