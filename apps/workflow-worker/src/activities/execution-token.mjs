// Per-execution credential validation, worker side (change:
// add-flows-tenancy-isolation-limits).
//
// The control-plane mints a short-lived token at flow start and carries it in the workflow
// argument's tenant envelope (apps/control-plane-executor/src/runtime/execution-token.mjs). Before an
// activity touches any tenant data store it MUST validate that token against the tenant +
// workspace stamped on the execution. A missing, expired, or cross-tenant token fails the activity
// with a NON-RETRYABLE Temporal ApplicationFailure (the failure is deterministic — retrying cannot
// heal it).
//
// This module is SELF-CONTAINED: it implements cron minting and the SAME token verification the
// control-plane uses, deriving the workspace-scoped signing key from the shared platform secret
// (FLOW_EXECUTION_TOKEN_SECRET). It does NOT import from `apps/control-plane-executor`, so the worker dist
// artifact stays decoupled from the control-plane package (consistent with how the other
// activities receive platform surfaces via dependency injection rather than cross-package imports).
// The token wire format and key derivation MUST stay byte-for-byte identical to the control-plane
// helper; both are exercised by the same black-box round-trip test.

import { createHmac, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { toNonRetryable } from './errors.mjs';

export const EXECUTION_TOKEN_EXPIRED = 'EXECUTION_TOKEN_EXPIRED';
export const EXECUTION_TOKEN_TENANT_MISMATCH = 'EXECUTION_TOKEN_TENANT_MISMATCH';
export const EXECUTION_TOKEN_INVALID = 'EXECUTION_TOKEN_INVALID';
export const EXECUTION_TOKEN_SECRET_UNCONFIGURED = 'EXECUTION_TOKEN_SECRET_UNCONFIGURED';

const EXECUTION_TOKEN_KEY_DERIVATION = 'scrypt-v1';
export const DEFAULT_MAX_RUN_DURATION_MS = 24 * 60 * 60 * 1000;

// MUST match apps/control-plane-executor/src/runtime/execution-token.mjs::DEV_SECRET.
const DEV_SECRET = 'falcone-dev-flow-execution-token-secret';

function platformSecret() {
  const configured = process.env.FLOW_EXECUTION_TOKEN_SECRET;
  if (process.env.NODE_ENV === 'production' && (!configured || Buffer.byteLength(configured, 'utf8') < 32)) {
    throw Object.assign(new Error('FLOW_EXECUTION_TOKEN_SECRET is not configured'),
      { code: EXECUTION_TOKEN_SECRET_UNCONFIGURED, statusCode: 503 });
  }
  return configured || DEV_SECRET;
}

// Workspace-scoped signing key derived from the platform secret and tenant identity.
function signingKey(tenantId, workspaceId, secret) {
  return scryptSync(secret, `${tenantId}\n${workspaceId}`, 32);
}

function expectedSignature(payloadJson, tenantId, workspaceId, secret) {
  return createHmac('sha256', signingKey(tenantId, workspaceId, secret)).update(payloadJson).digest();
}

// Cron runs mint inside an activity, never inside the deterministic workflow sandbox.
export function mintExecutionToken(tenantId, workspaceId, maxRunDurationMs = DEFAULT_MAX_RUN_DURATION_MS, { now = Date.now() } = {}) {
  let secret;
  try { secret = platformSecret(); } catch (err) {
    throw toNonRetryable(err.code, err.message);
  }
  if (!tenantId || !workspaceId) {
    throw toNonRetryable(EXECUTION_TOKEN_INVALID, 'execution token requires tenantId and workspaceId');
  }
  const ttl = Math.max(0, Math.min(Number(maxRunDurationMs) || 0, DEFAULT_MAX_RUN_DURATION_MS));
  const payloadJson = JSON.stringify({ tenantId, workspaceId, expiresAt: now + ttl,
    jti: randomUUID(), keyDerivation: EXECUTION_TOKEN_KEY_DERIVATION });
  const sig = expectedSignature(payloadJson, tenantId, workspaceId, secret);
  return `${Buffer.from(payloadJson).toString('base64url')}.${sig.toString('base64url')}`;
}

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
 * Validate the per-execution token an activity received against the execution's tenant context.
 * Returns the decoded payload on success; throws a NON-RETRYABLE Temporal ApplicationFailure
 * (type === the token error code) on any failure. Fail-closed: a missing token is invalid.
 *
 * @param {string} token            the token carried in the workflow argument's tenant envelope
 * @param {string} expectedTenantId tenant the workflow execution belongs to
 * @param {string} expectedWorkspaceId workspace the workflow execution belongs to
 * @param {{ now?: number }} [opts]
 */
export function assertExecutionToken(token, expectedTenantId, expectedWorkspaceId, { now = Date.now() } = {}) {
  const decoded = decodePayload(token);
  if (!decoded) {
    throw toNonRetryable(EXECUTION_TOKEN_INVALID, 'execution token is missing or malformed');
  }
  let secret;
  try { secret = platformSecret(); } catch (err) {
    throw toNonRetryable(err.code, err.message);
  }
  const { obj, payloadJson, sig } = decoded;
  if (!obj.tenantId || !obj.workspaceId || typeof obj.expiresAt !== 'number') {
    throw toNonRetryable(EXECUTION_TOKEN_INVALID, 'execution token payload is incomplete');
  }
  if (obj.keyDerivation !== EXECUTION_TOKEN_KEY_DERIVATION) {
    throw toNonRetryable(EXECUTION_TOKEN_INVALID, 'execution token key derivation is unsupported');
  }
  // Verify the signature using the key derived from the TOKEN's own claimed identity so a
  // forged-identity token never validates. Constant-time compare.
  const expSig = expectedSignature(payloadJson, obj.tenantId, obj.workspaceId, secret);
  let providedSig;
  try {
    providedSig = Buffer.from(sig, 'base64url');
  } catch {
    throw toNonRetryable(EXECUTION_TOKEN_INVALID, 'execution token signature is malformed');
  }
  if (providedSig.length !== expSig.length || !timingSafeEqual(providedSig, expSig)) {
    throw toNonRetryable(EXECUTION_TOKEN_INVALID, 'execution token signature is invalid');
  }
  // Tenant/workspace scope MUST match the execution the activity is acting for.
  if (obj.tenantId !== expectedTenantId || obj.workspaceId !== expectedWorkspaceId) {
    throw toNonRetryable(EXECUTION_TOKEN_TENANT_MISMATCH, 'execution token tenant/workspace mismatch');
  }
  if (now >= obj.expiresAt) {
    throw toNonRetryable(EXECUTION_TOKEN_EXPIRED, 'execution token has expired');
  }
  return obj;
}
