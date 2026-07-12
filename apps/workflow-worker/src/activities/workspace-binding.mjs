// Workspace binding for first-party flow activities (change:
// fix-flow-activity-workspace-binding / #663).
//
// SECURITY BOUNDARY — the decisive cross-workspace isolation guard for the activity catalog.
//
// Every first-party activity (llm.complete, db.query, events.publish, functions.invoke) runs
// against a workspace-scoped surface (BYOK provider/key, RLS-scoped data, evt.<ws>.<topic>,
// workspace-scoped function lookup). The workspace MUST be the one the per-execution token is
// bound to — NOT a value a flow author can smuggle in through a task node's `input`.
//
// `catalog.mjs::dispatchTask` validates the per-execution HMAC token against the
// token-bound `tenant.tenantId` + `tenant.workspaceId` BEFORE a registered activity runs, so
// `tenant.workspaceId` is the trustworthy, execution-token-bound workspace. The activities used
// to do `params.workspaceId ?? tenant.workspaceId`, which let an author who controls the task
// `input` inject `workspaceId: <sibling-workspace-B>` (same tenant) and execute the task against
// workspace B's BYOK provider/key/quota/data while running under workspace A's token
// (cross-workspace resource theft / IDOR, #663).
//
// `resolveActivityWorkspaceId(params, tenant)` is the single shared resolver all four activities
// call so the rule lives in one place:
//   - token-bound path (production): when `tenant.workspaceId` is present, USE it. A
//     `params.workspaceId` is at best redundant: if it equals the token workspace it is harmless
//     (no override); if it DIFFERS it is a cross-workspace override attempt → fail closed with a
//     NON-RETRYABLE FORBIDDEN. The author can never widen scope to a foreign workspace.
//   - legacy path: when `tenant.workspaceId` is ABSENT (the interpreter graph-walk harness with
//     execution-token enforcement off, as documented in catalog.mjs — production always stamps a
//     token), fall back to `params.workspaceId` so the existing fixtures keep working.
// The caller keeps its own "requires a workspaceId" guard (UNAUTHENTICATED when neither is
// present): this resolver returns `undefined` in that case rather than throwing, so each activity
// can attach its own task-typed message.
import { toNonRetryable } from './errors.mjs';

/**
 * Resolve the workspace a first-party activity must execute against, binding to the
 * execution-token workspace and refusing a caller-supplied foreign override.
 *
 * @param {{ workspaceId?: string }} params  the task node input (author-controlled)
 * @param {{ workspaceId?: string }} tenant  the execution TenantContext (token-bound)
 * @returns {string|undefined} the workspace to use, or undefined when none is available
 *   (the caller raises its own UNAUTHENTICATED error).
 * @throws {ApplicationFailure} non-retryable FORBIDDEN when the token workspace is present and
 *   the task input carries a DIFFERENT workspaceId (a cross-workspace override attempt).
 */
export function resolveActivityWorkspaceId(params = {}, tenant = {}) {
  const tokenWorkspaceId = tenant?.workspaceId;
  const inputWorkspaceId = params?.workspaceId;

  if (tokenWorkspaceId) {
    // Token-bound (production) path: the token workspace is authoritative.
    if (inputWorkspaceId != null && inputWorkspaceId !== tokenWorkspaceId) {
      throw toNonRetryable(
        'FORBIDDEN',
        'task input may not override the execution workspace',
      );
    }
    return tokenWorkspaceId;
  }

  // Legacy path: no token-bound workspace (interpreter harness with token enforcement off).
  return inputWorkspaceId;
}
