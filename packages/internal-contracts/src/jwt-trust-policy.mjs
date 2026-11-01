// Shared JWT trust and cryptographic verification for both HTTP runtimes.
import crypto from 'node:crypto';

const b64urlToBuf = (s) => Buffer.from(s, 'base64url');
const b64urlToJson = (s) => JSON.parse(b64urlToBuf(s).toString('utf8'));
const ALG_DIGEST = { RS256: 'sha256', RS384: 'sha384', RS512: 'sha512' };

// Derive the Keycloak realms base (".../realms/") and the platform realm name from whichever of the
// issuer or the JWKS certs URL is shaped like a Keycloak realm endpoint. Returns nulls when neither
// is realm-shaped (legacy single-key mode, e.g. a bare JWKS URL).
export function deriveRealmTopology(issuer, jwksUrl) {
  const fromIssuer = typeof issuer === 'string' && /^(.*\/realms\/)([^/]+)$/.exec(issuer);
  if (fromIssuer) return { realmsBase: fromIssuer[1], platformRealm: fromIssuer[2] };
  const fromJwks = typeof jwksUrl === 'string'
    && /^(.*\/realms\/)([^/]+)\/protocol\/openid-connect\/certs\/?$/.exec(jwksUrl);
  if (fromJwks) return { realmsBase: fromJwks[1], platformRealm: fromJwks[2] };
  return { realmsBase: null, platformRealm: null };
}

// Returns a verifier { verify(token) -> { payload, trust } }. `trust` is
// { kind: 'platform'|'tenant'|'legacy', realm? } where `realm` (the verified tenant id) is set only
// for tenant-realm tokens.
// `revocationCheck` (fix-sa-credential-revocation-invalidate-tokens, #684): an OPTIONAL async hook
// `(claims) => boolean` run AFTER all offline validation passes. Returning true rejects the token
// (its underlying credential was revoked/rotated). Default undefined = no-op → fully back-compatible
// (offline-only verification, every existing test unchanged). It is the verifier's only statefulness
// and only fires for service-account tokens (the hook itself pre-filters non-SA tokens, no DB hit).
export function createRealmTokenVerifier({
  jwksUrl,
  issuer = null,
  audience = null,
  trustedRealmBases,
  platformAudiences,
  platformRealm: configuredPlatformRealm,
  tenantAudience,
  enforceTenantAudience = false,
  fetchImpl = fetch,
  clockToleranceSec = 60,
  cacheMs = 300_000,
  allowTenantRealms = true,
  revocationCheck = undefined,
  now = () => Date.now(),
  logger = console,
} = {}) {
  if (typeof enforceTenantAudience !== 'boolean') throw new Error('enforceTenantAudience must be boolean');
  if (enforceTenantAudience && (typeof tenantAudience !== 'string' || !tenantAudience.trim())) {
    throw new Error('tenant audience is required when enforcement is enabled');
  }
  if (enforceTenantAudience && !jwksUrl) throw new Error('JWKS URL is required when tenant audience enforcement is enabled');
  const { realmsBase, platformRealm: derivedPlatformRealm } = deriveRealmTopology(issuer, jwksUrl);
  const platformRealm = configuredPlatformRealm ?? derivedPlatformRealm;
  if (enforceTenantAudience && !realmsBase) throw new Error('Keycloak realm topology is required when tenant audience enforcement is enabled');
  const explicitBases = trustedRealmBases !== undefined;
  const bases = explicitBases ? validateRealmBases(trustedRealmBases) : (realmsBase ? [realmsBase] : []);
  if (explicitBases || configuredPlatformRealm !== undefined) {
    const jwksRealm = deriveRealmTopology(null, jwksUrl).platformRealm;
    if (!platformRealm || (derivedPlatformRealm && derivedPlatformRealm !== platformRealm) || (jwksRealm && jwksRealm !== platformRealm)) {
      throw new Error('platform realm must match issuer and JWKS realm');
    }
    if (explicitBases && issuer && !bases.some((base) => issuer === `${base}${platformRealm}`)) {
      throw new Error('platform issuer must use an allowlisted realm base');
    }
  }
  const audiences = platformAudiences === undefined ? (audience ? [audience] : []) : validateStringList(platformAudiences, 'platformAudiences');
  const platformIssuer = issuer || (realmsBase ? `${realmsBase}${platformRealm}` : undefined);
  const caches = new Map();

  function classifyIssuer(iss) {
    if (!explicitBases && !issuer && !realmsBase) return { kind: 'legacy' };
    if (!explicitBases && platformIssuer && iss === platformIssuer) return { kind: 'platform' };
    if (typeof iss !== 'string') return null;
    for (const base of bases) {
      if (!iss.startsWith(base)) continue;
      const realm = iss.slice(base.length);
      // Only a single literal realm segment under an exact configured base is trusted.
      if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(realm)) continue;
      if (realm === platformRealm) return { kind: 'platform' };
      if (allowTenantRealms) return { kind: 'tenant', realm };
    }
    return null;
  }

  function jwksUrlForIssuer(iss, kind) {
    return kind === 'tenant' ? `${iss}/protocol/openid-connect/certs` : jwksUrl;
  }

  async function jwks(url, force) {
    const c = caches.get(url);
    if (!force && c && c.keys.length && now() - c.at < cacheMs) return c.keys;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const body = await res.json();
    const keys = Array.isArray(body.keys) ? body.keys : [];
    caches.set(url, { keys, at: now() });
    return keys;
  }

  async function publicKeyFor(url, kid, alg) {
    const match = (keys) => keys.find((k) =>
      k.kty === 'RSA' && (!kid || k.kid === kid) && (!k.alg || k.alg === alg));
    let jwk = match(await jwks(url, false));
    if (!jwk) jwk = match(await jwks(url, true)); // key rotation: refetch once
    if (!jwk) throw new Error('no matching JWKS key');
    return crypto.createPublicKey({ key: jwk, format: 'jwk' });
  }

  return {
    classifyIssuer,
    realmTopology: () => ({ realmsBase, platformRealm }),
    async verify(token) {
      const parts = String(token).split('.');
      let category = 'malformed';
      let claims;
      let trust;
      try {
        if (parts.length !== 3) throw new Error('malformed JWT');
        const [h, p, s] = parts;
        const header = b64urlToJson(h);
        claims = b64urlToJson(p);
        if (!header || typeof header !== 'object' || Array.isArray(header) || !claims || typeof claims !== 'object' || Array.isArray(claims)) throw new Error('malformed JWT');
        category = 'alg';
        const digest = Object.hasOwn(ALG_DIGEST, header.alg) ? ALG_DIGEST[header.alg] : undefined;
        if (!digest) throw new Error('unsupported alg'); // Reject unsigned tokens and HS* confusion.

        // Decide which realm (and thus which JWKS) this token belongs to BEFORE trusting it.
        category = 'issuer';
        trust = classifyIssuer(claims.iss);
        if (!trust) throw new Error('issuer not trusted');

        category = 'key_lookup';
        const key = await publicKeyFor(jwksUrlForIssuer(claims.iss, trust.kind), header.kid, header.alg);
        category = 'signature';
        if (!crypto.verify(digest, Buffer.from(`${h}.${p}`), key, b64urlToBuf(s))) {
          throw new Error('bad signature');
        }
        const t = Math.floor(now() / 1000);
        category = 'expiry';
        if (typeof claims.exp === 'number' && t > claims.exp + clockToleranceSec) throw new Error('token expired');
        category = 'nbf';
        if (typeof claims.nbf === 'number' && t + clockToleranceSec < claims.nbf) throw new Error('token not yet valid');
        // Match only aud membership; azp never participates in audience validation.
        category = 'audience';
        if (trust.kind === 'platform' && audiences.length) {
          const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
          if (!audiences.some((accepted) => aud.includes(accepted))) throw new Error('audience mismatch');
        }
        if (trust.kind === 'tenant' && enforceTenantAudience) {
          const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
          if (!aud.includes(tenantAudience)) throw new Error('tenant audience mismatch');
        }
        // Stateful revocation/rotation cutoff: offline validation cannot see that a service-account
        // credential was revoked or rotated. The injected hook (DB-backed, SA-only) decides; a true
        // result rejects the otherwise-valid token. Non-SA tokens are skipped inside the hook.
        category = 'revoked';
        if (revocationCheck && await revocationCheck(claims, trust)) throw new Error('credential revoked');
        return { payload: claims, trust };
      } catch {
        const messages = {
          malformed: 'malformed JWT', alg: 'unsupported alg', issuer: 'issuer not trusted',
          key_lookup: 'no matching JWKS key or JWKS fetch failed', signature: 'bad signature',
          expiry: 'token expired', nbf: 'token not yet valid',
          audience: trust?.kind === 'tenant' ? 'tenant audience mismatch' : 'audience mismatch',
          revoked: 'credential revoked',
        };
        logVerificationFailure(logger, category, claims, parts);
        throw Object.assign(new Error(messages[category]), { category });
      }
    },
  };
}

function validateStringList(value, name) {
  if (!Array.isArray(value) || !value.length || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${name} must be a non-empty array of strings`);
  }
  return [...new Set(value)];
}

function validateRealmBases(value) {
  return validateStringList(value, 'trustedRealmBases').map((base) => {
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname.includes('*') || url.username || url.password || url.search || url.hash
      || !url.pathname.endsWith('/realms/') || url.href !== base) {
      throw new Error('trustedRealmBases must contain exact HTTP(S) realm bases ending in /realms/');
    }
    return base;
  });
}

// Only bounded diagnostics from untrusted metadata may enter a log. Never forward errors,
// claims, or arbitrary objects. Redact JWT segments even if copied into an aud value.
function logVerificationFailure(logger, category, claims, parts) {
  const safe = (value) => {
    if (typeof value !== 'string' || value.length > 128 || /[^\x20-\x7e]/.test(value)
      || parts.some((part) => part && value.includes(part))) return '<REDACTED>';
    return value;
  };
  let issHost = null;
  try { issHost = safe(new URL(claims?.iss).host); } catch { /* No usable issuer host. */ }
  const values = Array.isArray(claims?.aud) ? claims.aud : (claims?.aud === undefined ? [] : [claims.aud]);
  const aud = values.slice(0, 8).map(safe);
  try { logger?.warn?.(JSON.stringify({ category, issHost, aud })); } catch { /* Logging cannot change the verdict. */ }
}

export function tenantAudienceOptionsFromEnv(env = process.env) {
  const flag = env.KEYCLOAK_ENFORCE_TENANT_AUDIENCE;
  if (flag !== undefined && flag !== 'true' && flag !== 'false') {
    throw new Error('KEYCLOAK_ENFORCE_TENANT_AUDIENCE must be true or false');
  }
  return {
    tenantAudience: env.KEYCLOAK_TENANT_AUDIENCE,
    enforceTenantAudience: flag === 'true',
  };
}

// Shared deployment contract. Arrays are JSON to avoid ambiguous comma/URL parsing.
// Legacy single-issuer and bare-JWKS configurations keep their existing defaults.
export function jwtVerifierOptionsFromEnv(env = process.env) {
  const list = (name) => env[name] === undefined ? undefined : validateStringList(JSON.parse(env[name]), name);
  return {
    jwksUrl: env.KEYCLOAK_JWKS_URL,
    issuer: env.KEYCLOAK_ISSUER || undefined,
    audience: env.KEYCLOAK_AUDIENCE || undefined,
    trustedRealmBases: list('KEYCLOAK_TRUSTED_REALM_BASES'),
    platformRealm: env.KEYCLOAK_PLATFORM_REALM || undefined,
    platformAudiences: list('KEYCLOAK_PLATFORM_AUDIENCES'),
    ...tenantAudienceOptionsFromEnv(env),
    allowTenantRealms: env.KEYCLOAK_ALLOW_TENANT_REALMS !== '0',
  };
}
