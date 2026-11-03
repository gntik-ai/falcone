import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

const load = (relative) => JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), 'utf8'));
// Match capability-grants: its vendored definitions require relaxed Ajv strict mode.
const ajv = new Ajv2020({ allErrors: true, strict: false });
const grantSchema = load('../capability-grants/capability-grants.v1.schema.json');
ajv.addSchema(grantSchema);
const validClaims = ajv.compile(load('./execution-credential.v1.claims.schema.json'));
const validGrants = ajv.getSchema(grantSchema.$id);
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const reject = (reason) => ({ verdict: 'reject', reason });

// Test-only model. No signing, issuing, registry mutation or runtime authorization.
export function verify(claims, context) {
  try {
    if (!context || !Number.isFinite(context.max_lifetime_seconds) || context.max_lifetime_seconds <= 0) {
      return reject('invalid-lifetime-config');
    }
    const contextKeys = new Set([
      'now', 'max_lifetime_seconds', 'attempt_deadline', 'tenant', 'workspace', 'pool_profile',
      'revision', 'activation', 'attempt', 'audience', 'attempt_state', 'pinned_grants',
      'requested_capability', 'holder', 'handle_registry', 'presented_handle', 'guest_scope',
    ]);
    if (!validClaims(claims) || !Number.isFinite(claims.iat) || !Number.isFinite(claims.exp)
      || typeof context !== 'object' || Array.isArray(context)
      || Object.keys(context).some((key) => !contextKeys.has(key))) return reject('malformed-claims');
    if (!['wasm-host-binding', 'oci-shim'].includes(context.holder)) return reject('untrusted-holder');
    if (claims.iss !== 'falcone:admission-dispatch') return reject('wrong-issuer');
    if (claims.aud !== context.audience) return reject('wrong-audience');
    if (!Number.isFinite(context.now) || !Number.isFinite(context.attempt_deadline)
      || context.now < 0 || context.attempt_deadline < 0
      || !(claims.iat <= context.now && context.now < claims.exp)
      || claims.exp > context.attempt_deadline
      || claims.exp - claims.iat > context.max_lifetime_seconds) return reject('expired-or-overlong');
    if (claims.tenant !== context.tenant) return reject('tenant-mismatch');
    if (claims.workspace !== context.workspace) return reject('workspace-mismatch');
    if (['pool_profile', 'revision', 'activation', 'attempt'].some((key) => claims[key] !== context[key])) {
      return reject('scope-mismatch');
    }
    if (context.attempt_state !== 'active') return reject('attempt-not-active');
    if (!validGrants(context.pinned_grants)
      || !claims.allowed_capabilities.every((allowed) => context.pinned_grants.some((grant) => canonical(grant) === canonical(allowed)))) {
      return reject('capabilities-outside-grants');
    }
    if (!claims.allowed_capabilities.some((allowed) => canonical(allowed) === canonical(context.requested_capability))) {
      return reject('requested-capability-not-allowed');
    }
    if (context.guest_scope !== undefined) {
      const guest = context.guest_scope;
      if (!guest || typeof guest !== 'object' || Array.isArray(guest)
        || Object.keys(guest).some((key) => !['tenant', 'workspace'].includes(key) || guest[key] !== claims[key])) {
        return reject('guest-scope-mismatch');
      }
    }
    const opaque = (handle) => typeof handle === 'string' && /^[A-Za-z0-9_-]+$/.test(handle)
      && !/-----BEGIN|-----END/.test(handle);
    if (!opaque(context.presented_handle) || !Array.isArray(context.handle_registry)
      || context.handle_registry.some((entry) => !entry || typeof entry !== 'object'
        || Object.keys(entry).sort().join(',') !== 'attempt,handle,state'
        || !opaque(entry.handle) || typeof entry.attempt !== 'string' || entry.attempt.length === 0
        || !['active', 'completed', 'cancelled', 'expired'].includes(entry.state))
      || new Set(context.handle_registry.map((entry) => entry.handle)).size !== context.handle_registry.length) {
      return reject('malformed-handle');
    }
    const entry = context.handle_registry.find((candidate) => candidate.handle === context.presented_handle);
    if (!entry) return reject('unknown-handle');
    if (entry.attempt !== context.attempt || entry.state !== 'active') return reject('handle-not-bound-to-attempt');
    return { verdict: 'accept', reason: null };
  } catch {
    return reject('malformed-claims');
  }
}
