// Signing material belongs exclusively to the control plane (External Secrets/OpenBao).
// Never copy this module or the private-key configuration into a function image.
import { createHash, createPrivateKey, createPublicKey, randomUUID, sign } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

function invocationConfiguration(env, signing = false) {
  if (!env.FN_INVOCATION_SECRET_DIR) return env;
  let directory = env.FN_INVOCATION_SECRET_DIR;
  try {
    // Pin one kubelet projection so rotation cannot mix files from two key sets.
    directory = realpathSync(join(directory, '..data'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // Read on every operation: optional Secret volumes can appear after startup.
  // A configured mount is authoritative; never fall back to stale env keys.
  return {
    ...(signing ? {
      FN_INVOCATION_PRIVATE_KEY: readFileSync(join(directory, 'private-key'), 'utf8'),
      FN_INVOCATION_KEY_ID: readFileSync(join(directory, 'key-id'), 'utf8').trim(),
    } : {}),
    FN_INVOCATION_JWKS: readFileSync(join(directory, 'jwks'), 'utf8'),
  };
}

export function invocationPublicJwks(env = process.env) {
  try {
    return publicJwks(invocationConfiguration(env));
  } catch {
    throw new Error('Function invocation public keys are not configured correctly');
  }
}

function publicJwks(env) {
  const jwks = JSON.parse(env.FN_INVOCATION_JWKS);
  if (!Array.isArray(jwks.keys) || !jwks.keys.length) throw new Error();
  const kids = new Set();
  const keys = jwks.keys.map((key) => {
    // Reconstruct public-only JWKs: never pass through private JWK fields.
    if (key.kty !== 'OKP' || key.crv !== 'Ed25519' || typeof key.x !== 'string'
      || typeof key.kid !== 'string' || !key.kid || kids.has(key.kid) || 'd' in key) throw new Error();
    kids.add(key.kid);
    const publicKey = { kty: 'OKP', crv: 'Ed25519', x: key.x, kid: key.kid };
    if (createPublicKey({ key: publicKey, format: 'jwk' }).asymmetricKeyType !== 'ed25519') throw new Error();
    return publicKey;
  });
  return { keys };
}

export function mintInvocationCredential(payload, caller, { audience, tenantId, workspaceId }, env = process.env) {
  try {
    if (![audience, tenantId, workspaceId].every((v) => typeof v === 'string' && v.length)) throw new Error();
    env = invocationConfiguration(env, true);
    const kid = env.FN_INVOCATION_KEY_ID;
    const privateKey = createPrivateKey(env.FN_INVOCATION_PRIVATE_KEY);
    if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error();
    const publicJwk = publicJwks(env).keys.find((key) => key.kid === kid);
    if (!publicJwk || createPublicKey(privateKey).export({ format: 'jwk' }).x !== publicJwk.x) throw new Error();
    const field = (value) => typeof value === 'string' && value.length ? value : null;
    const iat = Math.floor(Date.now() / 1000);
    const claims = {
      aud: audience, tenantId, workspaceId, iat, exp: iat + 60, jti: randomUUID(),
      bodySha256: createHash('sha256').update(payload).digest('hex'),
      caller: {
        tenantId: field(caller?.tenantId), workspaceId: field(caller?.workspaceId),
        principal: field(caller?.principal), actorType: field(caller?.actorType),
        roles: Array.isArray(caller?.roles) ? caller.roles.filter((r) => typeof r === 'string' && r.length) : [],
      },
    };
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const input = `${encode({ alg: 'EdDSA', typ: 'JWT', kid })}.${encode(claims)}`;
    return `${input}.${sign(null, Buffer.from(input), privateKey).toString('base64url')}`;
  } catch {
    // Crypto parsers may include key material in errors. Return only a fixed diagnostic.
    throw new Error('Function invocation signing is not configured correctly');
  }
}
