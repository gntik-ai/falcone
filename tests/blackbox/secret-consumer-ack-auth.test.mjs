// Black-box test suite for change authenticate-secret-consumer-ack (bug-013 / issue #215).
// Drives the PUBLIC action entrypoint (`main`) from secret-consumer-ack.mjs only.
// Fake db and repo are injected via params. No internal knowledge used.
//
// Tests: bbx-sec-ack-unauth-01, bbx-sec-ack-unregistered-01, bbx-sec-ack-identity-mismatch-01,
//        bbx-sec-ack-tenant-mismatch-01, bbx-sec-ack-success-01
import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../packages/provisioning-orchestrator/src/actions/secret-consumer-ack.mjs';

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const SECRET_PATH = `tenant/${TENANT_A}/db-password`;
const CONSUMER_ID = 'svc:consumer-a';
const VAULT_VERSION = 7;

// Authenticated service principal for consumer A, belonging to tenant A.
const authA = { sub: CONSUMER_ID, roles: ['consumer'], tenantId: TENANT_A };

function fakeDb() {
  return {};
}

// Sentinel used to distinguish "not supplied" from explicitly-null in fakeRepo options.
const UNSET = Symbol('UNSET');

// Builds a fake repo that tracks call counts so we can assert which methods were
// (or were not) invoked. The parameters control what the lookups return.
//
//   consumers      - array returned by listConsumers (default: consumer registered for CONSUMER_ID)
//   version        - object returned by getVersionByVaultVersion (default: tenant A version);
//                    pass null explicitly to simulate a not-found version row.
//   pendingBefore  - array returned by listPendingPropagations (default: one pending row for CONSUMER_ID)
function fakeRepo({ consumers = UNSET, version = UNSET, pendingBefore = UNSET } = {}) {
  const DEFAULT_CONSUMERS = [
    { consumer_id: CONSUMER_ID, consumer_namespace: 'ns-a', reload_mechanism: 'env' }
  ];
  const DEFAULT_VERSION = { tenant_id: TENANT_A, domain: 'tenant' };
  const DEFAULT_PENDING = [{ consumer_id: CONSUMER_ID }];

  const resolvedConsumers = consumers === UNSET ? DEFAULT_CONSUMERS : consumers;
  const resolvedVersion = version === UNSET ? DEFAULT_VERSION : version;
  const resolvedPending = pendingBefore === UNSET ? DEFAULT_PENDING : pendingBefore;

  const spy = {
    listConsumersCalled: 0,
    getVersionByVaultVersionCalled: 0,
    listPendingPropagationsCalled: 0,
    confirmPropagationCalled: 0,
    insertRotationEventCalled: 0,
    insertRotationEventArgs: null,
    publishEventCalled: 0,

    async listConsumers(_db, _secretPath) {
      spy.listConsumersCalled += 1;
      return resolvedConsumers;
    },
    async getVersionByVaultVersion(_db, _opts) {
      spy.getVersionByVaultVersionCalled += 1;
      return resolvedVersion;
    },
    async listPendingPropagations(_db, _opts) {
      spy.listPendingPropagationsCalled += 1;
      return resolvedPending;
    },
    async confirmPropagation(_db, _opts) {
      spy.confirmPropagationCalled += 1;
      return {};
    },
    async insertRotationEvent(_db, args) {
      spy.insertRotationEventCalled += 1;
      spy.insertRotationEventArgs = args;
      return {};
    }
  };
  return spy;
}

function fakePublishEvent() {
  let called = 0;
  const fn = async () => { called += 1; };
  fn.getCalled = () => called;
  return fn;
}

// bbx-sec-ack-unauth-01
// Auth absent entirely → 401 before any repo call.
test('bbx-sec-ack-unauth-01: unauthenticated ack (no auth) returns 401 before any repo call', async () => {
  const repo = fakeRepo();
  const result = await main({
    consumerId: CONSUMER_ID,
    secretPath: SECRET_PATH,
    vaultVersion: VAULT_VERSION,
    db: fakeDb(),
    repo
  });
  assert.equal(result?.error?.status, 401, `expected 401, got ${result?.error?.status}`);
  assert.equal(result?.error?.code, 'UNAUTHENTICATED');
  assert.equal(repo.listConsumersCalled, 0, 'listConsumers must NOT be called when unauthenticated');
  assert.equal(repo.confirmPropagationCalled, 0, 'confirmPropagation must NOT be called when unauthenticated');
  assert.equal(repo.insertRotationEventCalled, 0, 'insertRotationEvent must NOT be called when unauthenticated');
});

// bbx-sec-ack-unauth-02
// Auth present but auth.sub absent → 401 before any repo call.
test('bbx-sec-ack-unauth-02: unauthenticated ack (auth.sub missing) returns 401 before any repo call', async () => {
  const repo = fakeRepo();
  const result = await main({
    auth: { roles: ['consumer'], tenantId: TENANT_A }, // sub absent
    consumerId: CONSUMER_ID,
    secretPath: SECRET_PATH,
    vaultVersion: VAULT_VERSION,
    db: fakeDb(),
    repo
  });
  assert.equal(result?.error?.status, 401, `expected 401, got ${result?.error?.status}`);
  assert.equal(result?.error?.code, 'UNAUTHENTICATED');
  assert.equal(repo.confirmPropagationCalled, 0, 'confirmPropagation must NOT be called');
  assert.equal(repo.insertRotationEventCalled, 0, 'insertRotationEvent must NOT be called');
});

// bbx-sec-ack-unregistered-01
// Authenticated but consumerId not in listConsumers for secretPath → 403, no write.
test('bbx-sec-ack-unregistered-01: authenticated caller with unregistered consumerId returns 403', async () => {
  const repo = fakeRepo({ consumers: [] }); // empty registry — no consumers registered
  const result = await main({
    auth: authA,
    consumerId: CONSUMER_ID,
    secretPath: SECRET_PATH,
    vaultVersion: VAULT_VERSION,
    db: fakeDb(),
    repo
  });
  assert.equal(result?.error?.status, 403, `expected 403, got ${result?.error?.status}`);
  assert.equal(result?.error?.code, 'FORBIDDEN');
  assert.equal(repo.confirmPropagationCalled, 0, 'confirmPropagation must NOT be called for unregistered consumer');
  assert.equal(repo.insertRotationEventCalled, 0, 'insertRotationEvent must NOT be called for unregistered consumer');
});

// bbx-sec-ack-identity-mismatch-01
// Authenticated, but auth.sub !== consumerId (caller tries to ack on behalf of another consumer) → 403.
test('bbx-sec-ack-identity-mismatch-01: auth.sub !== consumerId returns 403', async () => {
  // The registry has CONSUMER_ID registered, but the caller's identity is different.
  const repo = fakeRepo();
  const result = await main({
    auth: { sub: 'svc:other-consumer', roles: ['consumer'], tenantId: TENANT_A },
    consumerId: CONSUMER_ID, // different from auth.sub
    secretPath: SECRET_PATH,
    vaultVersion: VAULT_VERSION,
    db: fakeDb(),
    repo
  });
  assert.equal(result?.error?.status, 403, `expected 403, got ${result?.error?.status}`);
  assert.equal(result?.error?.code, 'FORBIDDEN');
  assert.equal(repo.confirmPropagationCalled, 0, 'confirmPropagation must NOT be called on identity mismatch');
  assert.equal(repo.insertRotationEventCalled, 0, 'insertRotationEvent must NOT be called on identity mismatch');
});

// bbx-sec-ack-tenant-mismatch-01
// Registered consumer, but version.tenant_id does not match auth.tenantId → 403, no write.
test('bbx-sec-ack-tenant-mismatch-01: tenant mismatch returns 403', async () => {
  // version belongs to TENANT_B but the caller authenticates for TENANT_A
  const repo = fakeRepo({ version: { tenant_id: TENANT_B, domain: 'tenant' } });
  const result = await main({
    auth: authA, // tenantId: TENANT_A
    consumerId: CONSUMER_ID,
    secretPath: SECRET_PATH,
    vaultVersion: VAULT_VERSION,
    db: fakeDb(),
    repo
  });
  assert.equal(result?.error?.status, 403, `expected 403, got ${result?.error?.status}`);
  assert.equal(result?.error?.code, 'FORBIDDEN');
  assert.equal(repo.confirmPropagationCalled, 0, 'confirmPropagation must NOT be called on tenant mismatch');
  assert.equal(repo.insertRotationEventCalled, 0, 'insertRotationEvent must NOT be called on tenant mismatch');
});

// bbx-sec-ack-version-not-found-01
// Version not found for (secretPath, vaultVersion) → treated as 403, no write.
test('bbx-sec-ack-version-not-found-01: version not found returns 403', async () => {
  const repo = fakeRepo({ version: null });
  const result = await main({
    auth: authA,
    consumerId: CONSUMER_ID,
    secretPath: SECRET_PATH,
    vaultVersion: VAULT_VERSION,
    db: fakeDb(),
    repo
  });
  assert.equal(result?.error?.status, 403, `expected 403, got ${result?.error?.status}`);
  assert.equal(repo.confirmPropagationCalled, 0, 'confirmPropagation must NOT be called when version not found');
  assert.equal(repo.insertRotationEventCalled, 0, 'insertRotationEvent must NOT be called when version not found');
});

// bbx-sec-ack-success-01
// Full happy path: auth.sub === consumerId, consumer registered, tenant matches.
// Must call confirmPropagation, insertRotationEvent with actorId=auth.sub (NOT consumerId),
// publishEvent, and return { ack: true }.
test('bbx-sec-ack-success-01: valid authenticated consumer ack succeeds', async () => {
  const repo = fakeRepo();
  const publishEvent = fakePublishEvent();
  const result = await main({
    auth: authA,
    consumerId: CONSUMER_ID,
    secretPath: SECRET_PATH,
    vaultVersion: VAULT_VERSION,
    db: fakeDb(),
    repo,
    publishEvent
  });
  assert.equal(result?.ack, true, `expected { ack: true }, got ${JSON.stringify(result)}`);
  assert.equal(result?.error, undefined, 'must not return an error on success');
  assert.equal(repo.confirmPropagationCalled, 1, 'confirmPropagation must be called exactly once');
  assert.equal(repo.insertRotationEventCalled, 1, 'insertRotationEvent must be called once (pending propagation exists)');
  // The actorId in the audit event MUST be the authenticated principal, not the caller-supplied consumerId.
  assert.equal(
    repo.insertRotationEventArgs?.actorId,
    authA.sub,
    `actorId must be auth.sub (${authA.sub}), not caller-supplied consumerId`
  );
  assert.equal(publishEvent.getCalled(), 1, 'publishEvent must be called once');
});

// bbx-sec-ack-success-no-pending-01
// Happy path with no pending propagation row: confirmPropagation called, but insertRotationEvent
// must NOT be called (no pending row for this consumer), publishEvent still called.
test('bbx-sec-ack-success-no-pending-01: ack with no pending propagation skips insertRotationEvent', async () => {
  const repo = fakeRepo({ pendingBefore: [] }); // no pending rows
  const publishEvent = fakePublishEvent();
  const result = await main({
    auth: authA,
    consumerId: CONSUMER_ID,
    secretPath: SECRET_PATH,
    vaultVersion: VAULT_VERSION,
    db: fakeDb(),
    repo,
    publishEvent
  });
  assert.equal(result?.ack, true, `expected { ack: true }, got ${JSON.stringify(result)}`);
  assert.equal(repo.confirmPropagationCalled, 1, 'confirmPropagation must still be called');
  assert.equal(repo.insertRotationEventCalled, 0, 'insertRotationEvent must NOT be called when no pending propagation');
  assert.equal(publishEvent.getCalled(), 1, 'publishEvent must still be called');
});
