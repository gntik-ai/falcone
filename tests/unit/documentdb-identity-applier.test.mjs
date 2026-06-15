// Unit tests for the DocumentDB per-tenant identity applier (FerretDB migration, #458).
// No real engine: an injected fake wire-protocol client drives every branch. The fake
// records the exact wire commands so we assert createUser/updateUser/dropUser/usersInfo
// shapes match what ADR-14 confirmed FerretDB translates to a Postgres LOGIN role.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  provisionTenantIdentity,
  rotateTenantIdentityCredential,
  revokeTenantIdentity,
  documentdbUserName,
  generateCredentialPassword,
  apply,
  teardown,
  DOCUMENTDB_IDENTITY_PROVISION_FAILED,
} from '../../services/provisioning-orchestrator/src/appliers/documentdb-identity-applier.mjs';

// Fake wire-protocol client: { existingUsers, failOn } -> records commands, simulates engine.
function fakeWire({ existingUsers = [], failOn = null } = {}) {
  const users = new Set(existingUsers);
  const commands = [];
  const runCommand = async (dbName, command) => {
    commands.push({ dbName, command });
    const verb = Object.keys(command)[0];
    if (failOn === verb) { const e = new Error(`engine refused ${verb}`); throw e; }
    if (command.usersInfo != null) {
      return { users: users.has(command.usersInfo) ? [{ user: command.usersInfo }] : [] };
    }
    if (command.createUser != null) { users.add(command.createUser); return { ok: 1 }; }
    if (command.updateUser != null) { return { ok: 1 }; }
    if (command.dropUser != null) { users.delete(command.dropUser); return { ok: 1 }; }
    return { ok: 1 };
  };
  return { runCommand, commands, users };
}

function recordingSecretStore() {
  const writes = [];
  return { writes, put: async ({ tenantId, path, value, version }) => { writes.push({ tenantId, path, value, version }); return { name: `documentdb-${tenantId}`, path }; } };
}

const quietLog = { info: () => {} };

test('documentdbUserName: sanitises tenantId to a safe falcone_doc_ identifier', () => {
  assert.equal(documentdbUserName('Tenant-A 01'), 'falcone_doc_tenant_a_01');
  assert.equal(documentdbUserName('ten_B'), 'falcone_doc_ten_b');
  assert.throws(() => documentdbUserName(''), /non-empty string/);
});

test('provision: issues createUser readWrite on the per-tenant namespace + returns one-time envelope', async () => {
  const wire = fakeWire();
  const secretStore = recordingSecretStore();
  const audits = [];
  const res = await provisionTenantIdentity('ten_A', {
    credentials: { runCommand: wire.runCommand }, secretStore, emitAudit: (e) => audits.push(e), log: quietLog,
  });

  assert.equal(res.provisioned, true);
  assert.equal(res.userName, 'falcone_doc_ten_a');
  assert.equal(res.credentialVersion, 1);
  // createUser issued against the per-tenant namespace with readWrite on that namespace.
  const create = wire.commands.find((c) => c.command.createUser);
  assert.ok(create, 'createUser issued');
  assert.equal(create.dbName, 'falcone_doc_ten_a');
  assert.equal(create.command.createUser, 'falcone_doc_ten_a');
  assert.deepEqual(create.command.roles, [{ role: 'readWrite', db: 'falcone_doc_ten_a' }]);
  assert.equal(typeof create.command.pwd, 'string');
  assert.ok(create.command.pwd.length >= 32);
  // One-time envelope carries the plaintext; secret store got it; nothing else persists it.
  assert.equal(res.oneTimeCredential.password, create.command.pwd);
  assert.equal(secretStore.writes.length, 1);
  assert.equal(secretStore.writes[0].value, create.command.pwd);
  assert.equal(res.secretRef.path, 'documentdb/tenants/falcone_doc_ten_a/credential');
  assert.equal(audits[0].eventType, 'documentdb_identity_provisioned');
  assert.equal(audits[0].eventCategory, 'credential_rotation');
});

test('provision: idempotent — existing credential is a no-op (no duplicate createUser, no new envelope)', async () => {
  const wire = fakeWire({ existingUsers: ['falcone_doc_ten_a'] });
  const secretStore = recordingSecretStore();
  const res = await provisionTenantIdentity('ten_A', { credentials: { runCommand: wire.runCommand }, secretStore, log: quietLog });

  assert.equal(res.provisioned, false);
  assert.equal(res.oneTimeCredential, null);
  assert.equal(wire.commands.filter((c) => c.command.createUser).length, 0, 'no createUser issued');
  assert.equal(secretStore.writes.length, 0, 'no password written');
});

test('provision: enforces least privilege — demotes the engine-created SUPERUSER via pgQuery', async () => {
  // The engine creates the role as SUPERUSER (verified on the kind live run); the applier
  // must ALTER ROLE it to a least-privilege login role over the injected Postgres conn.
  const wire = fakeWire();
  const pgCalls = [];
  const pgQuery = async (sql) => { pgCalls.push(sql); };
  const res = await provisionTenantIdentity('ten_A', { credentials: { runCommand: wire.runCommand }, pgQuery, log: quietLog });
  assert.equal(res.leastPrivilegeEnforced, true);
  assert.equal(pgCalls.length, 1);
  assert.match(pgCalls[0], /ALTER ROLE "falcone_doc_ten_a" NOSUPERUSER NOBYPASSRLS/);
});

test('provision: without pgQuery, leastPrivilegeEnforced is false (credential not demoted)', async () => {
  const wire = fakeWire();
  const res = await provisionTenantIdentity('ten_A', { credentials: { runCommand: wire.runCommand }, log: { info() {}, warn() {} } });
  assert.equal(res.provisioned, true);
  assert.equal(res.leastPrivilegeEnforced, false);
});

test('provision: fail-closed when least-privilege demotion errors (never hand out a superuser)', async () => {
  const wire = fakeWire();
  const pgQuery = async () => { throw new Error('pg connection refused'); };
  await assert.rejects(
    provisionTenantIdentity('ten_A', { credentials: { runCommand: wire.runCommand }, pgQuery, log: quietLog }),
    (err) => err.code === DOCUMENTDB_IDENTITY_PROVISION_FAILED,
  );
});

test('provision: fail-closed — createUser engine error throws DOCUMENTDB_IDENTITY_PROVISION_FAILED', async () => {
  const wire = fakeWire({ failOn: 'createUser' });
  await assert.rejects(
    provisionTenantIdentity('ten_A', { credentials: { runCommand: wire.runCommand }, log: quietLog }),
    (err) => { assert.equal(err.code, DOCUMENTDB_IDENTITY_PROVISION_FAILED); return true; },
  );
});

test('rotate: issues updateUser with a NEW password, bumps version, updates secret store, audits', async () => {
  const wire = fakeWire({ existingUsers: ['falcone_doc_ten_a'] });
  const secretStore = recordingSecretStore();
  const audits = [];
  const res = await rotateTenantIdentityCredential('ten_A', {
    credentials: { runCommand: wire.runCommand }, secretStore, emitAudit: (e) => audits.push(e), currentVersion: 1, rotationReason: 'scheduled',
  });

  assert.equal(res.rotated, true);
  assert.equal(res.credentialVersion, 2);
  const update = wire.commands.find((c) => c.command.updateUser);
  assert.equal(update.command.updateUser, 'falcone_doc_ten_a');
  assert.equal(typeof update.command.pwd, 'string');
  assert.equal(secretStore.writes.at(-1).version, 2);
  assert.equal(audits[0].eventType, 'documentdb_identity_rotated');
  assert.equal(audits[0].rotationReason, 'scheduled');
});

test('rotate: fail-closed on updateUser engine error', async () => {
  const wire = fakeWire({ existingUsers: ['falcone_doc_ten_a'], failOn: 'updateUser' });
  await assert.rejects(
    rotateTenantIdentityCredential('ten_A', { credentials: { runCommand: wire.runCommand } }),
    (err) => err.code === DOCUMENTDB_IDENTITY_PROVISION_FAILED,
  );
});

test('revoke: issues dropUser when the credential exists', async () => {
  const wire = fakeWire({ existingUsers: ['falcone_doc_ten_a'] });
  const audits = [];
  const res = await revokeTenantIdentity('ten_A', { credentials: { runCommand: wire.runCommand }, emitAudit: (e) => audits.push(e), log: quietLog });
  assert.equal(res.revoked, true);
  assert.equal(res.alreadyAbsent, false);
  assert.ok(wire.commands.find((c) => c.command.dropUser === 'falcone_doc_ten_a'));
  assert.equal(audits[0].eventType, 'documentdb_identity_revoked');
});

test('revoke: no-op offboarding when no credential exists (pre-migration tenant)', async () => {
  const wire = fakeWire(); // no users
  const res = await revokeTenantIdentity('ten_X', { credentials: { runCommand: wire.runCommand }, log: quietLog });
  assert.equal(res.revoked, false);
  assert.equal(res.alreadyAbsent, true);
  assert.equal(wire.commands.filter((c) => c.command.dropUser).length, 0);
});

test('apply/teardown adapters return DomainResult with documentdb_identity domain_key', async () => {
  const wire = fakeWire();
  const provided = await apply('ten_A', {}, { credentials: { runCommand: wire.runCommand }, log: quietLog });
  assert.equal(provided.domain_key, 'documentdb_identity');
  assert.equal(provided.status, 'applied');
  assert.equal(provided.counts.created, 1);

  const removed = await teardown('ten_A', {}, { credentials: { runCommand: wire.runCommand }, log: quietLog });
  assert.equal(removed.domain_key, 'documentdb_identity');
  assert.equal(removed.status, 'applied');
});

test('apply adapter: engine failure -> error DomainResult (not a throw), counts.errors=1', async () => {
  const wire = fakeWire({ failOn: 'createUser' });
  const res = await apply('ten_A', {}, { credentials: { runCommand: wire.runCommand }, log: quietLog });
  assert.equal(res.status, 'error');
  assert.equal(res.counts.errors, 1);
});

test('generated password is non-empty, URL-safe, and not a provider-shaped literal', () => {
  const pw = generateCredentialPassword();
  assert.match(pw, /^[A-Za-z0-9_-]+$/);
  assert.ok(pw.length >= 40);
  assert.doesNotMatch(pw, /^mongodb\+srv:|^SCRAM-/);
});
