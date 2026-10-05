import { createHash, createPublicKey, verify } from 'node:crypto';

// Allow small node-clock differences at issuance; expiry remains strict.
const ISSUED_AT_LEEWAY_SECONDS = 3;

// Capture target identity and public keys before tenant code can change process.env.
// No signing implementation or private key is present in this image.
export function createInvocationVerifier(env = process.env) {
  const audience = env.K_SERVICE || env.FN_KSVC_NAME;
  const tenantId = env.FN_TENANT_ID;
  const workspaceId = env.FN_WORKSPACE_ID;
  const keys = new Map();
  try {
    const jwks = JSON.parse(env.FN_INVOCATION_JWKS);
    if (![audience, tenantId, workspaceId].every((v) => typeof v === 'string' && v.length)
      || !Array.isArray(jwks.keys) || !jwks.keys.length) throw new Error();
    for (const key of jwks.keys) {
      if (key.kty !== 'OKP' || key.crv !== 'Ed25519' || 'd' in key
        || typeof key.kid !== 'string' || !key.kid || keys.has(key.kid)) throw new Error();
      keys.set(key.kid, createPublicKey({ key, format: 'jwk' }));
    }
  } catch {
    keys.clear(); // Missing or malformed configuration denies every POST; probes still work.
  }
  return (authorization, body, now = Math.floor(Date.now() / 1000)) => {
    try {
      if (typeof authorization !== 'string' || authorization.length > 16384
        || !authorization.startsWith('Bearer ')) return null;
      const parts = authorization.slice(7).split('.');
      if (parts.length !== 3 || !parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) return null;
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      const key = keys.get(header.kid);
      if (header.alg !== 'EdDSA' || header.typ !== 'JWT' || !key
        || !verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))) return null;
      const c = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      if (c.aud !== audience || c.tenantId !== tenantId || c.workspaceId !== workspaceId
        || !Number.isSafeInteger(c.iat) || !Number.isSafeInteger(c.exp)
        || c.iat > now + ISSUED_AT_LEEWAY_SECONDS || c.exp <= now || c.exp <= c.iat || c.exp - c.iat > 60
        || typeof c.jti !== 'string' || !c.jti
        || c.bodySha256 !== createHash('sha256').update(body).digest('hex')) return null;
      const caller = c.caller;
      if (!caller || !['tenantId', 'workspaceId', 'principal', 'actorType'].every(
        (field) => caller[field] === null || (typeof caller[field] === 'string' && caller[field].length),
      ) || !Array.isArray(caller.roles) || !caller.roles.every((r) => typeof r === 'string' && r.length)) return null;
      return Object.freeze({
        tenantId: caller.tenantId, workspaceId: caller.workspaceId,
        principal: caller.principal, actorType: caller.actorType,
        roles: Object.freeze([...caller.roles]),
      });
    } catch {
      return null;
    }
  };
}
