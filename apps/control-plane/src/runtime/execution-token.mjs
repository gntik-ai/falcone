// Per-execution short-lived credential (change: add-flows-tenancy-isolation-limits).
//
// design.md D5 — a tenant-scoped service token is minted at flow start, scoped to exactly
// `{ tenantId, workspaceId }` of the triggering identity, and carried via the Temporal workflow
// memo (NOT a search attribute — memo is not queryable). Activities validate the token before
// touching tenant data; an expired or cross-tenant token fails the activity with a
// non-retryable error.
//
// Mechanism: an HMAC-SHA256 over the canonical JSON payload using a workspace-scoped signing
// key, consistent with the API-key verification path in resolveIdentity. The token is a compact
// `<base64url(payload)>.<base64url(hmac)>` string; the payload carries `tenantId`,
// `workspaceId`, `expiresAt` (epoch ms) and a random `jti`. Validation is constant-time on the
// signature and fail-closed on every malformed/foreign/expired input.
//
// The signing key is derived per workspace from a single platform secret
// (FLOW_EXECUTION_TOKEN_SECRET) so the control-plane (minting) and the worker (validating) share
// it without distributing per-workspace material. A missing secret in test/black-box mode falls
// back to a fixed dev key so the round-trip is exercisable without infra (the same backend split
// api-keys.mjs uses).

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

// Default maximum flow run duration the token must not outlast. Mirrors the conservative
// Temporal workflowExecutionTimeout the interpreter uses; tokens expire WITH the run, never after.
export const DEFAULT_MAX_RUN_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

// Stable non-retryable error codes the activity surfaces (spec scenarios).
export const EXECUTION_TOKEN_EXPIRED = 'EXECUTION_TOKEN_EXPIRED';
export const EXECUTION_TOKEN_TENANT_MISMATCH = 'EXECUTION_TOKEN_TENANT_MISMATCH';
export const EXECUTION_TOKEN_INVALID = 'EXECUTION_TOKEN_INVALID';

const DEV_SECRET = 'falcone-dev-flow-execution-token-secret';

function platformSecret() {
  return process.env.FLOW_EXECUTION_TOKEN_SECRET || DEV_SECRET;
}

// Derive a workspace-scoped signing key from the single platform secret. HMAC over the workspace
// identity so a leaked per-workspace key never reveals the platform secret or another workspace.
function signingKey(tenantId, workspaceId, secret = platformSecret()) {
  // HMAC key derivation for token signing, not stored password hashing.
  // codeql[js/insufficient-password-hash]
  return createHmac('sha256', secret).update(`${tenantId}\n${workspaceId}`).digest();
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sign(payloadJson, tenantId, workspaceId, secret) {
  // HMAC token signature, not stored password hashing.
  // codeql[js/insufficient-password-hash]
  return createHmac('sha256', signingKey(tenantId, workspaceId, secret)).update(payloadJson).digest();
}

/**
 * Mint a per-execution token scoped to `{ tenantId, workspaceId }`. `expiresAt` (epoch ms) is
 * clamped so it never outlasts `maxRunDurationMs` from `now`.
 *
 * @returns {string} compact `<payload>.<sig>` token
 */
export function mintExecutionToken(tenantId, workspaceId, maxRunDurationMs = DEFAULT_MAX_RUN_DURATION_MS, {
  now = Date.now(),
  secret = platformSecret(),
  jti = randomUUID(),
} = {}) {
  if (!tenantId || !workspaceId) {
    throw Object.assign(new Error('mintExecutionToken requires tenantId and workspaceId'), { code: 'TOKEN_MINT_INVALID' });
  }
  const ttl = Math.max(0, Math.min(Number(maxRunDurationMs) || 0, DEFAULT_MAX_RUN_DURATION_MS));
  const payload = { tenantId, workspaceId, expiresAt: now + ttl, jti };
  const payloadJson = JSON.stringify(payload);
  const sig = sign(payloadJson, tenantId, workspaceId, secret);
  return `${b64url(payloadJson)}.${b64url(sig)}`;
}

// Decode the payload portion WITHOUT trusting it (signature is verified separately).
function decodePayload(token) {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  try {
    const json = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8');
    const obj = JSON.parse(json);
    if (!obj || typeof obj !== 'object') return null;
    return { obj, payloadJson: json, sig: token.slice(dot + 1) };
  } catch {
    return null;
  }
}

/**
 * Validate a token against the EXPECTED tenant + workspace the activity is acting for. Returns
 * the decoded payload on success; THROWS a non-retryable-classified error (carries `.code`) on
 * any failure so the caller maps it to a Temporal ApplicationFailure. Fail-closed throughout.
 *
 * @param {string} token
 * @param {string} expectedTenantId
 * @param {string} expectedWorkspaceId
 * @param {{ now?: number, secret?: string }} [opts]
 */
export function validateExecutionToken(token, expectedTenantId, expectedWorkspaceId, { now = Date.now(), secret = platformSecret() } = {}) {
  const decoded = decodePayload(token);
  if (!decoded) {
    throw Object.assign(new Error('Execution token is missing or malformed'), { code: EXECUTION_TOKEN_INVALID });
  }
  const { obj, payloadJson, sig } = decoded;
  if (!obj.tenantId || !obj.workspaceId || typeof obj.expiresAt !== 'number') {
    throw Object.assign(new Error('Execution token payload is incomplete'), { code: EXECUTION_TOKEN_INVALID });
  }
  // Verify the signature with the key derived from the TOKEN's own claimed identity first so a
  // forged-identity token never validates. Constant-time compare.
  const expectedSig = sign(payloadJson, obj.tenantId, obj.workspaceId, secret);
  let providedSig;
  try {
    providedSig = Buffer.from(sig, 'base64url');
  } catch {
    throw Object.assign(new Error('Execution token signature is malformed'), { code: EXECUTION_TOKEN_INVALID });
  }
  if (providedSig.length !== expectedSig.length || !timingSafeEqual(providedSig, expectedSig)) {
    throw Object.assign(new Error('Execution token signature is invalid'), { code: EXECUTION_TOKEN_INVALID });
  }
  // Tenant/workspace scope MUST match the execution the activity is acting for.
  if (obj.tenantId !== expectedTenantId || obj.workspaceId !== expectedWorkspaceId) {
    throw Object.assign(new Error('Execution token tenant/workspace does not match the execution'), { code: EXECUTION_TOKEN_TENANT_MISMATCH });
  }
  // Expiry — token must NOT outlast the run.
  if (now >= obj.expiresAt) {
    throw Object.assign(new Error('Execution token has expired'), { code: EXECUTION_TOKEN_EXPIRED });
  }
  return obj;
}
