// Service-account credential revocation/rotation check for the executor's auth path
// (fix-sa-credential-revocation-invalidate-tokens, #684).
//
// PARITY with apps/control-plane/sa-revocation.mjs (the two control-plane runtimes are kept
// behavior-identical). The executor authenticates user/admin requests directly (resolveIdentity →
// jwtVerifier.verify); without this check an access token already minted from a service-account
// credential would keep being accepted by the executor after the credential is revoked/rotated,
// for the rest of its natural ~300s lifetime.
//
// The `service_accounts` table is OWNED by the kind control-plane (apps/control-plane/
// tenant-store.mjs), but the executor connects to the SAME platform Postgres (`in_falcone`, role
// `falcone`) on its metadata pool — so it can read the table's revocation state. This module ships
// its own self-contained SELECT (no cross-tree import); the kind CP's ensureSchema() creates the
// `credentials_invalidated_at` column + the (iam_realm, kc_client_id) index at boot.
//
// The candidate SA client id (`sa-<ws-slug>-<saname>`) is UNIQUE only WITHIN a realm (the workspace
// slug is `UNIQUE (tenant_id, slug)`), so the revocation lookup is SCOPED by the realm (== tenant id)
// derived from the CRYPTOGRAPHICALLY-VERIFIED issuer (`claims.iss`) — never a forgeable claim. This
// prevents a cross-tenant kc_client_id collision from either defeating the check or spuriously
// rejecting another tenant's token. If the realm cannot be derived for a SA token, we fail closed.
//
// The returned function is `async (claims) => boolean` (true ⇒ token no longer valid), the exact
// shape the verifier's optional `revocationCheck` hook expects. Non-SA tokens are skipped (no DB hit).

// Extract the candidate client id a token was minted for. Keycloak puts the authorized party in
// `azp` (client_credentials grant); we tolerate the alternative claim names some flows surface.
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
// `classifyIssuer`: a tenant realm's issuer is `${realmsBase}${realm}`; the realm is the segment after
// the base (no nested slash) and is NOT the platform realm. Service accounts live ONLY in per-tenant
// realms, so a SA token from the platform realm / an untrusted issuer / legacy bare-JWKS mode yields
// undefined and the caller fails closed. Exported for unit testing.
export function realmFromIssuer(iss, { realmsBase, platformRealm } = {}) {
  if (typeof iss !== 'string' || !realmsBase || !iss.startsWith(realmsBase)) return undefined;
  const realm = iss.slice(realmsBase.length);
  if (!realm || realm.includes('/') || realm === platformRealm) return undefined;
  return realm;
}

// Pure decision: given a SA's revocation-relevant row and the token's `iat` (seconds), is the token
// revoked? Exported for direct unit testing of the boundary/skew logic. `skewSec` is the small clock
// skew allowed at SECOND granularity (Keycloak `iat` is whole seconds; the cutoff is floored to the
// second). A token issued in an earlier second than the cutoff (minus the skew) is rejected; a
// post-rotation token (iatSec ≥ cutoffSec) is never rejected. The same-second case is an inherent
// <1s blind spot of second-granularity `iat`.
export function isTokenRevokedForRow(row, iatSec, { skewSec = 1 } = {}) {
  if (!row) return false; // unknown SA / no row → not revoking (fail-open ONLY for absent state)
  if (row.status === 'revoked') return true;
  const cutoff = row.credentials_invalidated_at;
  if (cutoff == null) return false;
  const cutoffMs = cutoff instanceof Date ? cutoff.getTime() : new Date(cutoff).getTime();
  if (!Number.isFinite(cutoffMs)) return false;
  if (typeof iatSec !== 'number' || !Number.isFinite(iatSec)) return true; // watermark set, no iat → fail-closed
  const cutoffSec = Math.floor(cutoffMs / 1000);
  return iatSec < cutoffSec - skewSec;
}

// Default DB read: resolve a SA by its Keycloak client id (the token's `azp`) AND its realm
// (== tenant id, from the verified issuer) to its revocation state. The (iam_realm, kc_client_id)
// pair is unique within the table; the realm scope is what prevents cross-tenant collisions on a
// shared client id. Injectable for tests via the `lookupAuthState` option.
async function defaultLookupAuthState(pool, kcClientId, realm) {
  const { rows } = await pool.query(
    `SELECT status, credentials_invalidated_at
       FROM service_accounts WHERE kc_client_id = $1 AND iam_realm = $2
      ORDER BY created_at DESC LIMIT 1`, [kcClientId, realm]);
  return rows[0] ?? null;
}

// Build the verifier hook. Lookups are cached per (realm, client id) for `cacheMs` (also the
// propagation window upper bound). cacheMs=0 disables caching (immediate propagation).
// `realmsBase`/`platformRealm` come from the SAME Keycloak topology the verifier uses.
export function createSaRevocationCheck({
  pool,
  realmsBase = null,
  platformRealm = null,
  cacheMs = 10_000,
  skewSec = 1,
  lookupAuthState = defaultLookupAuthState,
  now = () => Date.now(),
  logger = console,
} = {}) {
  if (!pool) throw new TypeError('createSaRevocationCheck requires a pg pool');
  const cache = new Map(); // `${realm}\n${clientId}` -> { at, row }

  async function lookup(realm, clientId) {
    const key = `${realm}\n${clientId}`;
    const hit = cache.get(key);
    if (cacheMs > 0 && hit && now() - hit.at < cacheMs) return hit.row;
    let row;
    try {
      row = await lookupAuthState(pool, clientId, realm);
    } catch (e) {
      logger?.error?.('[sa-revocation] lookup failed (failing closed for SA token):', e?.message ?? e);
      throw e;
    }
    if (cacheMs > 0) cache.set(key, { at: now(), row });
    return row;
  }

  return async function revocationCheck(claims) {
    const clientId = clientIdFromClaims(claims);
    if (!isServiceAccountClientId(clientId)) return false; // not a SA token → skip (no DB hit)
    const realm = realmFromIssuer(claims?.iss, { realmsBase, platformRealm });
    if (!realm) {
      logger?.error?.('[sa-revocation] cannot derive realm for SA token (failing closed):', clientId);
      return true; // SA token whose realm is unknowable → fail closed (reject)
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
