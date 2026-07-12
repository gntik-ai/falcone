// Unit tests for the service-account credential revocation/rotation check
// (fix-sa-credential-revocation-invalidate-tokens, #684).
//
// Covers the pure decision (isTokenRevokedForRow), the realm derivation (realmFromIssuer) and the
// assembled hook (createSaRevocationCheck) against a fake auth-state lookup — no Postgres, no
// Keycloak. Encodes the issue's two scenarios at the verifier-hook level:
//   Scenario 1 (revoke): a SA whose status='revoked' → token rejected.
//   Scenario 2 (rotate): a SA token whose iat predates credentials_invalidated_at → rejected;
//                        a token minted after the cutoff → allowed.
// Plus the two reviewer-found regressions:
//   * cross-tenant kc_client_id collision: the lookup is SCOPED by the realm derived from the
//     verified issuer, so two tenants' same-named SAs never interfere (one revoked, the other active).
//   * rotate boundary: the watermark compares at SECOND granularity with a SMALL skew (default ≤1s),
//     not the old 5s subtraction, so a token minted ~2s before rotation is rejected.
// Plus: non-SA tokens are skipped with NO lookup, fail-closed on a lookup error, fail-closed when the
// realm cannot be derived for a SA token, caching/TTL keyed on (realm, clientId). The kind and
// executor copies are parity-tested.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSaRevocationCheck,
  isTokenRevokedForRow,
  isServiceAccountClientId,
  clientIdFromClaims,
  realmFromIssuer,
} from '../../apps/control-plane/sa-revocation.mjs';
import {
  createSaRevocationCheck as createSaRevocationCheckExecutor,
  isTokenRevokedForRow as isTokenRevokedForRowExecutor,
  realmFromIssuer as realmFromIssuerExecutor,
} from '../../apps/control-plane-executor/src/runtime/sa-revocation.mjs';

const SA_CLIENT = 'sa-acme-repro';
const USER_AZP = 'app-client';
const tNow = 1_900_000_000; // seconds
const nowMs = tNow * 1000;

// Keycloak realm topology used by the verifier (realm name == tenant id). Tenant realms sit under the
// realms base; the platform realm is excluded.
const REALMS_BASE = 'http://kc/realms/';
const PLATFORM_REALM = 'in-falcone-platform';
const REALM_A = 'ten-a';
const REALM_B = 'ten-b';
const ISS_A = `${REALMS_BASE}${REALM_A}`;
const ISS_B = `${REALMS_BASE}${REALM_B}`;
const topo = { realmsBase: REALMS_BASE, platformRealm: PLATFORM_REALM };

// A store fake keyed on (clientId, realm); counts calls so we can assert "no lookup for non-SA tokens"
// and caching, and that the realm is threaded through.
function fakeStore(rowsByRealmClient) {
  const calls = [];
  return {
    calls,
    async getServiceAccountAuthStateByClientId(_pool, clientId, realm) {
      calls.push([clientId, realm]);
      return rowsByRealmClient[`${realm}\n${clientId}`] ?? null;
    },
  };
}
const fakePool = { query: async () => { throw new Error('pool.query should not be called via store fake'); } };

// ---- pure decision (isTokenRevokedForRow) ---------------------------------

test('decision: status=revoked → revoked regardless of iat (Scenario 1)', () => {
  assert.equal(isTokenRevokedForRow({ status: 'revoked', credentials_invalidated_at: null }, tNow), true);
});

test('decision: active SA, no cutoff → not revoked', () => {
  assert.equal(isTokenRevokedForRow({ status: 'active', credentials_invalidated_at: null }, tNow), false);
});

test('decision: iat < cutoff → revoked (Scenario 2, pre-rotation token)', () => {
  const cutoff = new Date(nowMs); // cutoff == now
  const iat = tNow - 120;         // minted 2 min before the cutoff
  assert.equal(isTokenRevokedForRow({ status: 'active', credentials_invalidated_at: cutoff }, iat), true);
});

test('decision: iat >= cutoff → allowed (Scenario 2, post-rotation token)', () => {
  const cutoff = new Date(nowMs - 120_000); // cutoff 2 min ago
  const iat = tNow;                          // minted now (after the cutoff)
  assert.equal(isTokenRevokedForRow({ status: 'active', credentials_invalidated_at: cutoff }, iat), false);
});

// ---- rotate boundary (BLOCKING #2): second-granularity + small skew, NOT the old 5s window -------

test('decision (rotate boundary): token minted 2s before cutoff → revoked (the natural mint→rotate gap)', () => {
  const cutoff = new Date(nowMs); // cutoffSec == tNow
  assert.equal(isTokenRevokedForRow({ status: 'active', credentials_invalidated_at: cutoff }, tNow - 2), true,
    '2s before rotation must be caught (the old 5s tolerance let it survive)');
});

test('decision (rotate boundary): token minted 3s before cutoff → revoked', () => {
  const cutoff = new Date(nowMs);
  assert.equal(isTokenRevokedForRow({ status: 'active', credentials_invalidated_at: cutoff }, tNow - 3), true);
});

test('decision (rotate boundary): same-second-as-rotation token → NOT revoked (inherent <1s blind spot)', () => {
  // cutoff floored to the second == tNow; iat == tNow ⇒ kept (a same-second token may be post-rotation,
  // and second-granularity iat cannot distinguish it). Documented residual blind spot.
  const cutoff = new Date(nowMs + 400); // sub-second past tNow → cutoffSec still tNow
  assert.equal(isTokenRevokedForRow({ status: 'active', credentials_invalidated_at: cutoff }, tNow), false);
});

test('decision (rotate boundary): post-rotation token (iat ≥ cutoffSec) → never revoked', () => {
  const cutoff = new Date(nowMs);
  assert.equal(isTokenRevokedForRow({ status: 'active', credentials_invalidated_at: cutoff }, tNow + 1), false);
  assert.equal(isTokenRevokedForRow({ status: 'active', credentials_invalidated_at: cutoff }, tNow + 5), false);
});

test('decision (skew knob): with skewSec=0 a token 1s before cutoff is revoked', () => {
  const cutoff = new Date(nowMs);
  assert.equal(isTokenRevokedForRow({ status: 'active', credentials_invalidated_at: cutoff }, tNow - 1, { skewSec: 0 }), true);
  // Default skewSec=1 keeps a 1s-before token (boundary), but rejects 2s-before.
  assert.equal(isTokenRevokedForRow({ status: 'active', credentials_invalidated_at: cutoff }, tNow - 1), false);
  assert.equal(isTokenRevokedForRow({ status: 'active', credentials_invalidated_at: cutoff }, tNow - 2), true);
});

test('decision: cutoff set but no usable iat → revoked (fail-closed)', () => {
  assert.equal(isTokenRevokedForRow({ status: 'active', credentials_invalidated_at: new Date(nowMs) }, undefined), true);
});

test('decision: accepts a TIMESTAMPTZ string cutoff (pg text result)', () => {
  const cutoffIso = new Date(nowMs).toISOString();
  assert.equal(isTokenRevokedForRow({ status: 'active', credentials_invalidated_at: cutoffIso }, tNow - 120), true);
  assert.equal(isTokenRevokedForRow({ status: 'active', credentials_invalidated_at: cutoffIso }, tNow + 120), false);
});

test('decision: null row → not revoked (unknown SA)', () => {
  assert.equal(isTokenRevokedForRow(null, tNow), false);
});

// ---- realm derivation -----------------------------------------------------

test('realmFromIssuer: tenant realm under the base → realm name (== tenant id)', () => {
  assert.equal(realmFromIssuer(ISS_A, topo), REALM_A);
  assert.equal(realmFromIssuer(ISS_B, topo), REALM_B);
});

test('realmFromIssuer: platform realm / untrusted issuer / legacy mode → undefined (fail-closed)', () => {
  assert.equal(realmFromIssuer(`${REALMS_BASE}${PLATFORM_REALM}`, topo), undefined, 'platform realm');
  assert.equal(realmFromIssuer('http://evil/realms/ten-a', topo), undefined, 'outside the trusted base');
  assert.equal(realmFromIssuer(`${REALMS_BASE}ten-a/extra`, topo), undefined, 'nested path');
  assert.equal(realmFromIssuer(ISS_A, {}), undefined, 'no realmsBase configured (legacy)');
  assert.equal(realmFromIssuer(undefined, topo), undefined, 'no iss');
});

// ---- client-id helpers ----------------------------------------------------

test('clientIdFromClaims: prefers azp, tolerates clientId/client_id', () => {
  assert.equal(clientIdFromClaims({ azp: 'sa-x' }), 'sa-x');
  assert.equal(clientIdFromClaims({ clientId: 'sa-y' }), 'sa-y');
  assert.equal(clientIdFromClaims({ client_id: 'sa-z' }), 'sa-z');
  assert.equal(clientIdFromClaims({}), undefined);
});

test('isServiceAccountClientId: only sa- prefixed ids are service accounts', () => {
  assert.equal(isServiceAccountClientId('sa-acme-x'), true);
  assert.equal(isServiceAccountClientId('app-client'), false);
  assert.equal(isServiceAccountClientId(undefined), false);
});

// ---- assembled hook (createSaRevocationCheck) -----------------------------

test('hook (a): SA token with iat < cutoff → revoked', async () => {
  const store = fakeStore({ [`${REALM_A}\n${SA_CLIENT}`]: { status: 'active', credentials_invalidated_at: new Date(nowMs) } });
  const check = createSaRevocationCheck({ pool: fakePool, store, ...topo, cacheMs: 0, now: () => nowMs });
  assert.equal(await check({ azp: SA_CLIENT, iss: ISS_A, iat: tNow - 120 }), true);
  assert.deepEqual(store.calls, [[SA_CLIENT, REALM_A]], 'lookup is scoped by the verified realm');
});

test('hook (b): SA token with iat >= cutoff → allowed', async () => {
  const store = fakeStore({ [`${REALM_A}\n${SA_CLIENT}`]: { status: 'active', credentials_invalidated_at: new Date(nowMs - 120_000) } });
  const check = createSaRevocationCheck({ pool: fakePool, store, ...topo, cacheMs: 0, now: () => nowMs });
  assert.equal(await check({ azp: SA_CLIENT, iss: ISS_A, iat: tNow }), false);
});

test('hook (c): SA whose status=revoked → revoked', async () => {
  const store = fakeStore({ [`${REALM_A}\n${SA_CLIENT}`]: { status: 'revoked', credentials_invalidated_at: new Date(nowMs) } });
  const check = createSaRevocationCheck({ pool: fakePool, store, ...topo, cacheMs: 0, now: () => nowMs });
  assert.equal(await check({ azp: SA_CLIENT, iss: ISS_A, iat: tNow + 999 }), true, 'revoked status overrides a fresh iat');
});

test('hook (d): non-SA token (azp=app-client) → allowed with NO lookup', async () => {
  const store = fakeStore({ [`${REALM_A}\n${SA_CLIENT}`]: { status: 'revoked', credentials_invalidated_at: new Date(nowMs) } });
  const check = createSaRevocationCheck({ pool: fakePool, store, ...topo, cacheMs: 0, now: () => nowMs });
  assert.equal(await check({ azp: USER_AZP, iss: ISS_A, iat: tNow - 999 }), false);
  assert.equal(await check({ sub: 'u', iss: ISS_A, iat: tNow }), false, 'no azp at all → skipped');
  assert.deepEqual(store.calls, [], 'a non-SA token must never hit the store');
});

test('hook (e): a SA token whose realm cannot be derived (platform issuer) → fail-closed, NO lookup', async () => {
  const store = fakeStore({});
  const check = createSaRevocationCheck({ pool: fakePool, store, ...topo, cacheMs: 0, now: () => nowMs, logger: { error() {} } });
  assert.equal(await check({ azp: SA_CLIENT, iss: `${REALMS_BASE}${PLATFORM_REALM}`, iat: tNow }), true,
    'SA token from the platform realm has no tenant realm → reject');
  assert.equal(await check({ azp: SA_CLIENT, iat: tNow }), true, 'no iss at all → reject');
  assert.deepEqual(store.calls, [], 'fail-closed before any DB hit');
});

// ---- BLOCKING #1: cross-tenant kc_client_id collision ---------------------

test('hook (collision): SAME client id in two realms — realm A revoked, realm B active', async () => {
  // Two tenants each own `sa-acme-repro`. Realm A's credential is revoked; realm B's is healthy.
  const store = fakeStore({
    [`${REALM_A}\n${SA_CLIENT}`]: { status: 'revoked', credentials_invalidated_at: new Date(nowMs) },
    [`${REALM_B}\n${SA_CLIENT}`]: { status: 'active', credentials_invalidated_at: null },
  });
  const check = createSaRevocationCheck({ pool: fakePool, store, ...topo, cacheMs: 0, now: () => nowMs });
  // A realm-A token is rejected (the fix bites the right tenant)...
  assert.equal(await check({ azp: SA_CLIENT, iss: ISS_A, iat: tNow }), true, 'realm-A revoked token rejected');
  // ...and a realm-B token with the SAME client id is still accepted (no cross-tenant interference).
  assert.equal(await check({ azp: SA_CLIENT, iss: ISS_B, iat: tNow }), false, 'realm-B active token accepted');
  assert.deepEqual(store.calls, [[SA_CLIENT, REALM_A], [SA_CLIENT, REALM_B]],
    'each lookup carries its own realm — no shared cache entry, no arbitrary-row resolution');
});

test('hook (collision, reverse): realm B revoked must NOT reject realm A active', async () => {
  const store = fakeStore({
    [`${REALM_A}\n${SA_CLIENT}`]: { status: 'active', credentials_invalidated_at: null },
    [`${REALM_B}\n${SA_CLIENT}`]: { status: 'revoked', credentials_invalidated_at: new Date(nowMs) },
  });
  const check = createSaRevocationCheck({ pool: fakePool, store, ...topo, cacheMs: 0, now: () => nowMs });
  assert.equal(await check({ azp: SA_CLIENT, iss: ISS_A, iat: tNow }), false, 'realm-A valid token unaffected by realm-B revoke');
  assert.equal(await check({ azp: SA_CLIENT, iss: ISS_B, iat: tNow }), true);
});

// ---- caching (keyed on realm + clientId) ----------------------------------

test('hook: caches per (realm, client id) within TTL (one lookup), refreshes after TTL', async () => {
  const store = fakeStore({ [`${REALM_A}\n${SA_CLIENT}`]: { status: 'active', credentials_invalidated_at: null } });
  let clock = nowMs;
  const check = createSaRevocationCheck({ pool: fakePool, store, ...topo, cacheMs: 10_000, now: () => clock });
  await check({ azp: SA_CLIENT, iss: ISS_A, iat: tNow });
  await check({ azp: SA_CLIENT, iss: ISS_A, iat: tNow });
  assert.equal(store.calls.length, 1, 'second call within TTL served from cache');
  clock += 11_000; // advance past TTL
  await check({ azp: SA_CLIENT, iss: ISS_A, iat: tNow });
  assert.equal(store.calls.length, 2, 'lookup refreshed after TTL');
});

test('hook: cache does not cross realms — same client id in another realm is a distinct entry', async () => {
  const store = fakeStore({
    [`${REALM_A}\n${SA_CLIENT}`]: { status: 'active', credentials_invalidated_at: null },
    [`${REALM_B}\n${SA_CLIENT}`]: { status: 'revoked', credentials_invalidated_at: new Date(nowMs) },
  });
  const check = createSaRevocationCheck({ pool: fakePool, store, ...topo, cacheMs: 10_000, now: () => nowMs });
  assert.equal(await check({ azp: SA_CLIENT, iss: ISS_A, iat: tNow }), false);
  // Realm B must NOT be served realm A's cached (negative) result.
  assert.equal(await check({ azp: SA_CLIENT, iss: ISS_B, iat: tNow }), true, 'realm B looked up independently');
  assert.equal(store.calls.length, 2);
});

test('hook: a SA revoked AFTER its negative result is cached is still accepted until TTL (bounded window)', async () => {
  const rows = { [`${REALM_A}\n${SA_CLIENT}`]: { status: 'active', credentials_invalidated_at: null } };
  const store = {
    calls: [],
    async getServiceAccountAuthStateByClientId(_p, id, realm) { this.calls.push([id, realm]); return rows[`${realm}\n${id}`] ?? null; },
  };
  let clock = nowMs;
  const check = createSaRevocationCheck({ pool: fakePool, store, ...topo, cacheMs: 10_000, now: () => clock });
  assert.equal(await check({ azp: SA_CLIENT, iss: ISS_A, iat: tNow }), false);
  rows[`${REALM_A}\n${SA_CLIENT}`] = { status: 'revoked', credentials_invalidated_at: new Date(clock) }; // revoke now
  assert.equal(await check({ azp: SA_CLIENT, iss: ISS_A, iat: tNow }), false, 'within TTL: still cached-accepted');
  clock += 11_000;
  assert.equal(await check({ azp: SA_CLIENT, iss: ISS_A, iat: tNow }), true, 'after TTL: revocation is seen → rejected');
});

test('hook: a store lookup error fails CLOSED for a SA token (reject)', async () => {
  const store = {
    async getServiceAccountAuthStateByClientId() { throw new Error('db down'); },
  };
  const check = createSaRevocationCheck({ pool: fakePool, store, ...topo, cacheMs: 0, logger: { error() {} } });
  assert.equal(await check({ azp: SA_CLIENT, iss: ISS_A, iat: tNow }), true);
});

test('createSaRevocationCheck requires pool + store helper', () => {
  assert.throws(() => createSaRevocationCheck({ store: { getServiceAccountAuthStateByClientId() {} } }), /requires/);
  assert.throws(() => createSaRevocationCheck({ pool: fakePool, store: {} }), /requires/);
});

// ---- parity: executor copy behaves identically ----------------------------

test('parity: executor isTokenRevokedForRow matches the kind copy across cases', () => {
  const cases = [
    [{ status: 'revoked', credentials_invalidated_at: null }, tNow],
    [{ status: 'active', credentials_invalidated_at: null }, tNow],
    [{ status: 'active', credentials_invalidated_at: new Date(nowMs) }, tNow - 120],
    [{ status: 'active', credentials_invalidated_at: new Date(nowMs) }, tNow - 2],
    [{ status: 'active', credentials_invalidated_at: new Date(nowMs) }, tNow],
    [{ status: 'active', credentials_invalidated_at: new Date(nowMs) }, tNow + 1],
    [{ status: 'active', credentials_invalidated_at: new Date(nowMs - 120_000) }, tNow],
    [{ status: 'active', credentials_invalidated_at: new Date(nowMs) }, undefined],
    [null, tNow],
  ];
  for (const [row, iat] of cases) {
    assert.equal(isTokenRevokedForRowExecutor(row, iat), isTokenRevokedForRow(row, iat),
      `parity for row=${JSON.stringify(row)} iat=${iat}`);
  }
});

test('parity: executor realmFromIssuer matches the kind copy', () => {
  for (const iss of [ISS_A, ISS_B, `${REALMS_BASE}${PLATFORM_REALM}`, 'http://evil/realms/x', undefined]) {
    assert.equal(realmFromIssuerExecutor(iss, topo), realmFromIssuer(iss, topo), `parity for iss=${iss}`);
  }
});

test('parity: executor hook scopes by realm, skips non-SA, rejects revoked SA tokens', async () => {
  // The executor copy takes lookupAuthState(pool, clientId, realm) directly (no store object).
  const calls = [];
  const lookupAuthState = async (_p, id, realm) => {
    calls.push([id, realm]);
    return (id === SA_CLIENT && realm === REALM_A) ? { status: 'revoked', credentials_invalidated_at: new Date(nowMs) } : { status: 'active', credentials_invalidated_at: null };
  };
  const check = createSaRevocationCheckExecutor({ pool: fakePool, ...topo, cacheMs: 0, lookupAuthState, now: () => nowMs });
  assert.equal(await check({ azp: USER_AZP, iss: ISS_A, iat: tNow }), false);
  assert.deepEqual(calls, [], 'executor: non-SA token never hits the DB');
  assert.equal(await check({ azp: SA_CLIENT, iss: ISS_A, iat: tNow }), true, 'realm-A revoked');
  assert.equal(await check({ azp: SA_CLIENT, iss: ISS_B, iat: tNow }), false, 'realm-B active (same client id)');
  assert.deepEqual(calls, [[SA_CLIENT, REALM_A], [SA_CLIENT, REALM_B]]);
});

test('parity: executor hook fails closed when realm cannot be derived', async () => {
  const check = createSaRevocationCheckExecutor({
    pool: fakePool, ...topo, cacheMs: 0, lookupAuthState: async () => { throw new Error('should not query'); },
    now: () => nowMs, logger: { error() {} },
  });
  assert.equal(await check({ azp: SA_CLIENT, iss: `${REALMS_BASE}${PLATFORM_REALM}`, iat: tNow }), true);
});
