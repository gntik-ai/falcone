// Bearer JWT verification for the executor (Keycloak / OIDC), dependency-free (node:crypto).
//
// Lets the executor authenticate USER/ADMIN requests directly — deriving tenant/workspace
// from verified token claims — so admin operations (e.g. API-key issuance) work through ANY
// gateway, including one that does not inject x-tenant-id from the JWT (the kind standalone
// APISIX). Mirrors the control-plane's verification (KEYCLOAK_JWKS_URL / _ISSUER / _AUDIENCE).
//
// Hardened against the classic JWT pitfalls: the signing alg is restricted to RSA
// (RS256/384/512) and matched to an RSA JWKS key, so `alg:none` and HS* algorithm-confusion
// are rejected; exp/nbf, issuer and audience are enforced.
import crypto from 'node:crypto';

const b64urlToBuf = (s) => Buffer.from(s, 'base64url');
const b64urlToJson = (s) => JSON.parse(b64urlToBuf(s).toString('utf8'));
const ALG_DIGEST = { RS256: 'sha256', RS384: 'sha384', RS512: 'sha512' };

export function deriveIdentityFromClaims(claims, pathWorkspaceId) {
  const roles = claims.realm_access?.roles ?? [];
  const scopes = typeof claims.scope === 'string'
    ? claims.scope.split(' ').filter(Boolean)
    : (Array.isArray(claims.scopes) ? claims.scopes : []);
  return {
    tenantId: claims.tenant_id ?? undefined,
    workspaceId: claims.workspace_id ?? pathWorkspaceId,
    actorId: claims.sub,
    roleName: 'falcone_app', // a user/admin JWT is not an api-key → no SET ROLE / RLS dbRole
    roles,
    scopes,
  };
}

// Returns a verifier { verify(token, pathWorkspaceId) -> identity } or undefined when no
// jwksUrl is configured (the executor then falls back to gateway-injected identity headers).
export function createJwtVerifier({
  jwksUrl,
  issuer,
  audience,
  fetchImpl = fetch,
  clockToleranceSec = 60,
  cacheMs = 300_000,
  now = () => Date.now(),
} = {}) {
  if (!jwksUrl) return undefined;
  let cache = { keys: [], at: 0 };

  async function jwks(force) {
    if (!force && cache.keys.length && now() - cache.at < cacheMs) return cache.keys;
    const res = await fetchImpl(jwksUrl);
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const body = await res.json();
    cache = { keys: Array.isArray(body.keys) ? body.keys : [], at: now() };
    return cache.keys;
  }

  async function publicKeyFor(kid, alg) {
    const match = (keys) => keys.find((k) =>
      k.kty === 'RSA' && (!kid || k.kid === kid) && (!k.alg || k.alg === alg));
    let jwk = match(await jwks(false));
    if (!jwk) jwk = match(await jwks(true)); // key rotation: refetch once
    if (!jwk) throw new Error('no matching JWKS key');
    return crypto.createPublicKey({ key: jwk, format: 'jwk' });
  }

  return {
    async verify(token, pathWorkspaceId) {
      const parts = String(token).split('.');
      if (parts.length !== 3) throw new Error('malformed JWT');
      const [h, p, s] = parts;
      const header = b64urlToJson(h);
      const digest = ALG_DIGEST[header.alg];
      if (!digest) throw new Error(`unsupported alg ${header.alg}`); // rejects none / HS*
      const key = await publicKeyFor(header.kid, header.alg);
      if (!crypto.verify(digest, Buffer.from(`${h}.${p}`), key, b64urlToBuf(s))) {
        throw new Error('bad signature');
      }
      const claims = b64urlToJson(p);
      const t = Math.floor(now() / 1000);
      if (typeof claims.exp === 'number' && t > claims.exp + clockToleranceSec) throw new Error('token expired');
      if (typeof claims.nbf === 'number' && t + clockToleranceSec < claims.nbf) throw new Error('token not yet valid');
      if (issuer && claims.iss !== issuer) throw new Error('issuer mismatch');
      if (audience) {
        const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
        if (!aud.includes(audience)) throw new Error('audience mismatch');
      }
      return deriveIdentityFromClaims(claims, pathWorkspaceId);
    },
  };
}
