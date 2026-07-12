// Per-execution credential validation, worker side (change:
// add-flows-tenancy-isolation-limits).
//
// The control-plane mints a short-lived token at flow start and carries it in the Temporal
// workflow memo / tenant envelope (apps/control-plane-executor/src/runtime/execution-token.mjs). Before an
// activity touches any tenant data store it MUST validate that token against the tenant +
// workspace stamped on the execution. A missing, expired, or cross-tenant token fails the activity
// with a NON-RETRYABLE Temporal ApplicationFailure (the failure is deterministic — retrying cannot
// heal it).
//
// This module is SELF-CONTAINED: it re-implements the SAME token verification the control-plane
// minting side uses, deriving the workspace-scoped signing key from the shared platform secret
// (FLOW_EXECUTION_TOKEN_SECRET). It does NOT import from `apps/control-plane-executor`, so the worker dist
// artifact stays decoupled from the control-plane package (consistent with how the other
// activities receive platform surfaces via dependency injection rather than cross-package imports).
// The token wire format and key derivation MUST stay byte-for-byte identical to the control-plane
// helper; both are exercised by the same black-box round-trip test.

import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto';
import { toNonRetryable } from './errors.mjs';

export const EXECUTION_TOKEN_EXPIRED = 'EXECUTION_TOKEN_EXPIRED';
export const EXECUTION_TOKEN_TENANT_MISMATCH = 'EXECUTION_TOKEN_TENANT_MISMATCH';
export const EXECUTION_TOKEN_INVALID = 'EXECUTION_TOKEN_INVALID';

const EXECUTION_TOKEN_KEY_DERIVATION = 'scrypt-v1';

// MUST match apps/control-plane-executor/src/runtime/execution-token.mjs::DEV_SECRET.
const DEV_SECRET = 'falcone-dev-flow-execution-token-secret';

function platformSecret() {
  return process.env.FLOW_EXECUTION_TOKEN_SECRET || DEV_SECRET;
}

// Workspace-scoped signing key derived from the platform secret and tenant identity.
function signingKey(tenantId, workspaceId, secret) {
  return scryptSync(secret, `${tenantId}\n${workspaceId}`, 32);
}

function expectedSignature(payloadJson, tenantId, workspaceId, secret) {
  return createHmac('sha256', signingKey(tenantId, workspaceId, secret)).update(payloadJson).digest();
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
 * @param {string} token            the token carried in the Temporal memo / tenant envelope
 * @param {string} expectedTenantId tenant the workflow execution belongs to
 * @param {string} expectedWorkspaceId workspace the workflow execution belongs to
 * @param {{ now?: number }} [opts]
 */
export function assertExecutionToken(token, expectedTenantId, expectedWorkspaceId, { now = Date.now() } = {}) {
  const secret = platformSecret();
  const decoded = decodePayload(token);
  if (!decoded) {
    throw toNonRetryable(EXECUTION_TOKEN_INVALID, 'execution token is missing or malformed');
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
