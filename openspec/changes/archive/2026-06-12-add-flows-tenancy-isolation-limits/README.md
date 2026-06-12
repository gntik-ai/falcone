# add-flows-tenancy-isolation-limits

Tenancy model, isolation guarantees, quotas and audit — issue #362

## Implementation deviations (recorded; spec requirements unchanged, all still satisfied)

- **D1 — Tenancy model resolved to SHARED-NAMESPACE (design Q1).** ADR-11 (#356) selected the
  shared `falcone-flows` namespace with a `tenantId` custom search attribute (NOT
  namespace-per-tenant). The design supported both; the implementation activates only the
  shared-namespace branch. Tasks 3.4/3.5 (namespace-per-tenant derivation + lazy provisioning) are
  therefore N/A. The spec requirements are model-agnostic and fully met by the shared-namespace
  enforcement: server-stamped `tenantId`/`workspaceId` search attributes, a non-overridable
  visibility filter (`sanitizeClientQuery` strips client tenant clauses), and workflow-ID prefix
  interception before any Temporal RPC.

- **D2 — Per-execution token carried in the tenant envelope AND the Temporal memo.** The token is
  threaded through the interpreter's `InlineWorkflowInput.tenant.executionToken` (so every activity
  receives it) and mirrored into the workflow memo (`EXECUTION_TOKEN_MEMO_KEY`, not a search
  attribute → not queryable), per design D5.

- **D3 — Worker-side token validator is a self-contained re-implementation, not a cross-package
  import.** `services/workflow-worker/src/activities/execution-token.mjs` re-implements the SAME
  HMAC verification + key derivation as the control-plane minting side
  (`apps/control-plane/src/runtime/execution-token.mjs`) rather than importing it, so the worker
  dist artifact stays decoupled from the `apps/control-plane` package (consistent with how the
  other catalog activities receive platform surfaces via dependency injection). Wire-format
  interop (control-plane mints → worker validates) is proven by bbx-flows-ten-cred-09 and the
  real-stack round-trip env-flows-ten-cred-01.

- **D4 — Quota + audit are injected seams (`quotaGate`, `auditSink`).** The flow executor enforces
  quotas and emits audit only when these are wired (production wires a quota-enforce HTTP evaluator
  and the Kafka audit sink in `main.mjs`); the no-DB black-box default is unmetered / silent, the
  same backend split the in-memory store fallback uses. Quota breach → 429 `QUOTA_EXCEEDED` with
  `dimension`; audit emission is best-effort and never fails a flow request.

- **D5 — Quota migration numbered `121-flow-quota-dimensions.sql`** (next free number after the
  existing 120), following the `098-plan-base-limits.sql` seed pattern exactly.
