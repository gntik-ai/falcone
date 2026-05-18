## Why

Two registry lookups silently return the wrong shape or crash on missing
fields, with no audit-time signal. From
`openspec/audit/cap-o2-internal-contracts.md`:

- **B9** (`services/internal-contracts/src/index.mjs:525-546`) —
  `getAuditEventSchemaForSubsystem` tries three lookup branches
  (`schema.subsystems[id]`, `schema.subsystem_roster.find(entry =>
  entry.subsystem_id === id || entry.id === id)`,
  `schema.subsystem_roster[id]`). When none match, it returns the unfiltered
  top-level schema. A typo'd subsystem id silently authorises a caller to
  iterate every other subsystem's `event_types[]`.
- **B13** (`services/internal-contracts/src/index.mjs:1156`) —
  `resolveWorkspaceEffectiveCapabilities` calls
  `capability.allowedEnvironments.includes(workspaceEnvironment)` with no
  `?? []`. Any provider capability whose `allowedEnvironments` field is missing
  throws `TypeError: Cannot read properties of undefined (reading 'includes')`,
  failing the entire workspace resolution.
- **G8** restates B13 against the parallel call at
  `resolveTenantEffectiveCapabilities:1131` (`plan.capabilityKeys.includes`).
- **G17** restates the multi-branch silent fallback in
  `getAuditEventSchemaForSubsystem`.

## What Changes

- `getAuditEventSchemaForSubsystem` MUST return `null` when no branch matches;
  callers SHALL handle the `null` explicitly rather than receiving the full
  schema by accident.
- Defend `capability.allowedEnvironments` and `plan.capabilityKeys` with
  explicit "missing field" errors that name the offending registry entry
  rather than blowing up with TypeError.

## Capabilities

### Modified Capabilities

- `deployment-and-operations`: requirement on registry lookups — explicit
  null on miss, explicit named errors on missing shape fields.

## Impact

- **Affected code**:
  `services/internal-contracts/src/index.mjs:525-546, :1131, :1156`; every
  caller of `getAuditEventSchemaForSubsystem` (M1 audit consumers).
- **Migration required**: audit-pipeline consumers that previously received
  the unfiltered schema on miss must now branch on `null`.
- **Breaking changes**: typo'd subsystem ids previously appeared to "work";
  they now return `null` and fail loudly. Intended.
