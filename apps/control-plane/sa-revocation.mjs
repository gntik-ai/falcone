// Service-account credential revocation/rotation check for the auth path
// (fix-sa-credential-revocation-invalidate-tokens, #684).
//
// Offline JWT verification (signature + exp/nbf + issuer + audience) cannot see that a credential
// was revoked or rotated, so an access token already minted from a service-account credential keeps
// being accepted until its natural ~300s expiry. This module adds a DB-backed "not-before" check
// that the verifier runs AFTER offline validation, turning revoke/rotate into a bounded-propagation
// 401 for already-issued tokens — WITHOUT touching non-SA (user/owner) tokens, which never hit the DB.
//
// Design:
//  * Pre-filter on the SA client-id prefix `sa-` (see b-handlers.mjs::createServiceAccount:
//    `clientId = sa-${ws.slug…}-${slugify(displayName)}`). The candidate client id is the token's
//    `azp` (Keycloak authorized-party for a client_credentials grant); `clientId`/`client_id` are
//    tolerated as fallbacks. A non-SA token (user/owner tokens carry `azp=app-client` /
//    `<slug>-app`) is SKIPPED entirely — no DB hit, no behavior change.
//  * The client id is UNIQUE only WITHIN a realm — `sa-<ws-slug>-<saname>` where the workspace slug is
//    `UNIQUE (tenant_id, slug)`, so two different tenants can each own `sa-acme-repro`. Resolving by
//    client id ALONE returns an arbitrary tenant's row → it both defeats the check (a revoked
//    Tenant-A token can be judged active when Tenant-B's newer same-id row wins) and is a cross-tenant
//    isolation breach (Tenant B's revoke spuriously 401s Tenant A's valid token). So the lookup is
//    SCOPED by the realm, which equals the tenant id and is derived from the CRYPTOGRAPHICALLY-VERIFIED
//    issuer (`claims.iss`), exactly as the verifier derives the tenant id — never from a forgeable
//    claim. `service_accounts.iam_realm` stores precisely this realm. If the realm cannot be derived
//    for a SA token, we FAIL CLOSED (reject), consistent with the rest of the module.
//  * A SA is REVOKED when its row says `status='revoked'` OR its `credentials_invalidated_at`
//    watermark is set AND the token's `iat` predates it (minus a small skew allowance).
//  * A short per-(realm, client-id) cache (TTL = cacheMs) bounds the propagation window and keeps the
//    auth path off Postgres on the hot path. cacheMs=0 disables caching (immediate propagation).
//
// The returned function is `async (claims) => boolean` (true ⇒ the token is no longer valid), the
// exact shape the verifier's optional `revocationCheck` hook expects.

// Extract the candidate client id a token was minted for. Keycloak puts the authorized party in
// `azp`; we tolerate the alternative claim names some flows surface.
export function clientIdFromClaims(claims) {
  if (!claims || typeof claims !== 'object') return undefined;
  const c = claims.azp ?? claims.clientId ?? claims.client_id;
  return typeof c === 'string' && c.length > 0 ? c : undefined;
}

// True when this client id belongs to a Falcone service account (vs a user/owner app client).
export function isServiceAccountClientId(clientId) {
  return typeof clientId === 'string' && clientId.startsWith('sa-');
}

// Derive the realm (== tenant id) from a token's VERIFIED issuer, mirroring the verifier's
// `classifyIssuer`: a tenant realm's issuer is `${realmsBase}${realm}` and the realm is the segment
// after the base (no nested slash) and is NOT the platform realm. Service accounts live ONLY in
// per-tenant realms (b-handlers.mjs::createServiceAccount runs against the tenant realm), so a SA
// token issued by the platform realm — or by an issuer outside the trusted base — yields undefined
// and the caller fails closed. When no realm topology is configured (legacy bare-JWKS mode) the
// realm is unknowable; returns undefined → fail-closed for SA tokens. Exported for unit testing.
export function realmFromIssuer(iss, { realmsBase, platformRealm } = {}) {
  if (typeof iss !== 'string' || !realmsBase || !iss.startsWith(realmsBase)) return undefined;
  const realm = iss.slice(realmsBase.length);
  if (!realm || realm.includes('/') || realm === platformRealm) return undefined;
  return realm;
}

// Pure decision: given a SA's revocation-relevant row and the token's `iat` (seconds), is the token
// revoked? Exported for direct unit testing of the boundary/skew logic.
//   row: { status, credentials_invalidated_at } | null
//   iatSec: number | undefined (the JWT `iat`, seconds)
//   skewSec: tokens minted within this many seconds AFTER the cutoff are still allowed (clock skew).
//     Keycloak `iat` is whole SECONDS, so the comparison is done at SECOND granularity (the cutoff is
//     floored to the second). A token issued in an EARLIER second than the cutoff is rejected; a
//     post-rotation token (iatSec ≥ cutoffSec) is NEVER rejected by the watermark. The residual
//     same-second-as-rotation case (iatSec == cutoffSec) is an inherent <1s blind spot of
//     second-granularity `iat` and is intentionally kept (a same-second token may be post-rotation).
export function isTokenRevokedForRow(row, iatSec, { skewSec = 1 } = {}) {
  if (!row) return false; // unknown SA / no row → not revoking (fail-open ONLY for absent state)
  if (row.status === 'revoked') return true;
  const cutoff = row.credentials_invalidated_at;
  if (cutoff == null) return false;
  const cutoffMs = cutoff instanceof Date ? cutoff.getTime() : new Date(cutoff).getTime();
  if (!Number.isFinite(cutoffMs)) return false;
  if (typeof iatSec !== 'number' || !Number.isFinite(iatSec)) {
    // The watermark is set but the token carries no usable `iat` — we cannot prove it post-dates the
    // cutoff, so treat it as revoked (fail-closed). Keycloak access tokens always carry `iat`.
    return true;
  }
  const cutoffSec = Math.floor(cutoffMs / 1000);
  // Revoked when the token was issued in an earlier second than the cutoff, minus a SMALL skew
  // allowance. With skewSec ≤ 1 a token minted ≥ 2s before the rotation is always rejected (the
  // realistic "minted just before rotate" case), while a same-second-or-later token is kept.
  return iatSec < cutoffSec - skewSec;
}

// Build the verifier hook. `store.getServiceAccountAuthStateByClientId(pool, clientId, realm)` returns
// { status, credentials_invalidated_at } | null. Lookups are cached per (realm, client id) for
// `cacheMs`. `realmsBase`/`platformRealm` come from the SAME Keycloak topology the verifier uses
// (deriveRealmTopology(issuer, jwksUrl)) so the realm derived here matches the verifier's tenant id.
export function createSaRevocationCheck({
  pool,
  store,
  realmsBase = null,
  platformRealm = null,
  cacheMs = 10_000,
  skewSec = 1,
  now = () => Date.now(),
  logger = console,
} = {}) {
  if (!pool || !store || typeof store.getServiceAccountAuthStateByClientId !== 'function') {
    throw new TypeError('createSaRevocationCheck requires { pool, store.getServiceAccountAuthStateByClientId }');
  }
  // `${realm}\n${clientId}` -> { at, row } (row may be null). A negative result is cached too, so a
  // non-revoked SA does not re-query PG on every request within the TTL. The realm is part of the key
  // so two tenants' same-named SAs never share a cache entry.
  const cache = new Map();

  async function lookup(realm, clientId) {
    const key = `${realm}\n${clientId}`;
    const hit = cache.get(key);
    if (cacheMs > 0 && hit && now() - hit.at < cacheMs) return hit.row;
    let row = null;
    try {
      row = await store.getServiceAccountAuthStateByClientId(pool, clientId, realm);
    } catch (e) {
      // A transient DB error must NOT silently grant a revoked token: surface as revoked (fail-closed)
      // for SA tokens only. (Non-SA tokens never reach here.) Do not cache the error.
      logger?.error?.('[sa-revocation] lookup failed (failing closed for SA token):', e?.message ?? e);
      throw e;
    }
    if (cacheMs > 0) cache.set(key, { at: now(), row });
    return row;
  }

  return async function revocationCheck(claims) {
    const clientId = clientIdFromClaims(claims);
    if (!isServiceAccountClientId(clientId)) return false; // not a SA token → skip (no DB hit)
    // Scope the lookup by the cryptographically-verified realm (== tenant id). Without it the lookup
    // could resolve a DIFFERENT tenant's same-named SA (cross-tenant). If we cannot derive the realm
    // for a SA token, fail closed.
    const realm = realmFromIssuer(claims?.iss, { realmsBase, platformRealm });
    if (!realm) {
      logger?.error?.('[sa-revocation] cannot derive realm for SA token (failing closed):', clientId);
      return true;
    }
    let row;
    try {
      row = await lookup(realm, clientId);
    } catch {
      return true; // SA token + DB lookup failed → fail closed (reject)
    }
    return isTokenRevokedForRow(row, typeof claims?.iat === 'number' ? claims.iat : undefined, { skewSec });
  };
}
