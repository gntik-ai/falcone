## Why

`evaluateTenantLifecycleMutation` is the registry function that gates tenant
purge eligibility and authorisation. Today it fails open on both axes. From
`openspec/audit/cap-o2-internal-contracts.md`:

- **B2** (`services/internal-contracts/src/index.mjs:1524-1527`) — the retention
  gate is `const retentionReady = !purgeEligibleAt || new Date(purgeEligibleAt)
  .getTime() <= new Date(now).getTime();`. When `purgeEligibleAt` is absent
  from `governance.retentionPolicy`, `!undefined === true` and retention is
  treated as satisfied. A tenant with no retention policy passes the purge
  gate immediately.
- **B15** (`services/internal-contracts/src/index.mjs:1480-1481, :1548-1556`) —
  `hasElevatedAccess` and `hasSecondConfirmation` are caller-supplied booleans.
  Nothing in the function challenges them. A caller passing `{action:'purge',
  hasElevatedAccess:true, hasSecondConfirmation:true}` authorises any purge.
- **G10** restates the missing-field semantics for `purgeEligibleAt`; **G11**
  restates the rubber-stamp of the authorisation booleans.

## What Changes

- Replace the `!purgeEligibleAt` fall-through with an explicit "fail closed"
  branch: when `retentionPolicy.purgeEligibleAt` is missing, `retentionReady
  = false` and the function MUST emit `reasonCode: 'RETENTION_POLICY_MISSING'`.
- Require an `authorisationProof` argument (signed approval token or IAM
  decision envelope); ignore the bare boolean flags. Validate the proof's
  signature, audience, and expiry; reject when any check fails.
- Record an audit-trail entry on every purge evaluation — whether allowed or
  rejected — capturing the proof id, actor user id, retention computation,
  and result.

## Capabilities

### Modified Capabilities

- `deployment-and-operations`: requirement on the tenant lifecycle evaluator —
  retention must fail closed; authorisation must be cryptographically
  verifiable; every evaluation must be auditable.

## Impact

- **Affected code**: `services/internal-contracts/src/index.mjs:1474-1603`;
  every caller of `evaluateTenantLifecycleMutation` (control plane purge
  workflow, console adapter, governance dashboard).
- **Migration required**: introduce an `authorisationProof` envelope schema
  (re-use the existing IAM decision envelope if available) and document its
  required fields.
- **Breaking changes**: callers using `hasElevatedAccess: true` /
  `hasSecondConfirmation: true` bare booleans MUST migrate to the
  proof-bearing call; intended.
