## Why

Five smaller defects in the internal-contracts registry corrupt idempotency,
inventory totals, purge enforcement, and URL uniqueness. From
`openspec/audit/cap-o2-internal-contracts.md`:

- **B5** (`services/internal-contracts/src/index.mjs:1728`) — bootstrap
  idempotency key is `'signup-activation-${tenantId ?? 'tenant'}-${workspaceId
  ?? 'workspace'}'`. Two retries with null context collide on
  `'signup-activation-tenant-workspace'`.
- **B8** (`services/internal-contracts/src/index.mjs:1177`) — workspace
  subdomain is `${slug}.apps.${env}.<base>`; two tenants with slug `'main'`
  in the same environment collide. No tenant qualifier in the subdomain.
- **B14** (`services/internal-contracts/src/index.mjs:1308-1313`) — `countBy`
  guards `if (!key) return counts;`. Resources with `state: ''` or `kind: 0`
  are skipped from `resourcesByKind`/`resourcesByState` totals.
- **B16** (`services/internal-contracts/src/index.mjs:1460-1471`) —
  `buildTenantPurgeDraft.confirmationText` is decorative; nothing in
  `evaluateTenantLifecycleMutation` compares the caller text against it.
- **B18** (`services/internal-contracts/src/index.mjs:1728`) — the same
  `signup-activation-${tenantId}-${workspaceId}` key collides across plans for
  the same workspace.
- **G12** restates B16; **G13** restates B14; **G14** confirms `sumQuotaUsage`
  is safe in the common case but flags the surrounding code; **G15** flags
  `evaluatePlanChange`'s dead-conditional ternary; **G18** flags
  `workspaceOpenApiVersion` exported but unused by versioning logic.

## What Changes

- Replace the bootstrap idempotency key with
  `signup-activation-${tenantId}-${workspaceId}-${planId}-${provisioningRunId}`;
  reject the call when any component is null.
- Add a tenant qualifier to the workspace subdomain
  (`${slug}.${tenantSlug}.apps.${env}.<base>`); reject ambiguous slugs at
  resolution time.
- Tighten `countBy` to skip only `undefined`/`null` keys; count `''`, `0`,
  `false` under their own bucket.
- Wire `confirmationText` enforcement into the purge gate: the caller's
  `confirmationText` MUST equal the draft's `confirmationText`.
- Remove the dead-conditional ternary at `index.mjs:1738-1739` (cleaned up
  alongside the redundant lookups in `fix-o2-plan-change-quota-drift`).
- Drop the unused `workspaceOpenApiVersion` export.

## Capabilities

### Modified Capabilities

- `deployment-and-operations`: requirement on idempotency-key composition,
  workspace URL uniqueness, inventory counting, purge confirmation, and
  removal of dead exports.

## Impact

- **Affected code**: `services/internal-contracts/src/index.mjs:1177, :1308,
  :1460, :1471, :1728`; downstream callers of the purge draft contract.
- **Migration required**: workspace URL change is breaking — operators with
  existing `${slug}.apps.<env>.<base>` URLs must migrate to the
  tenant-qualified form during a transition window.
- **Breaking changes**: tenant-qualified workspace URLs; idempotency keys
  rejected when context is null; intended.
