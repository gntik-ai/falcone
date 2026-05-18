## Why

The `services/internal-contracts/src/index.mjs` registry ships three load-bearing
defaults that silently corrupt production correlation, eligibility, and URL
routing. From `openspec/audit/cap-o2-internal-contracts.md`:

- **B1** (`services/internal-contracts/src/index.mjs:1177`) —
  `getWorkspaceApplicationBaseUrl` returns
  `https://${slug}.apps.${env}.in-falcone.example.com/${app}` for the
  `optional_workspace_subdomain` branch. Every workspace URL in that branch
  routes to the IETF-reserved `example.com` test domain.
- **B4** (`services/internal-contracts/src/index.mjs:1111, :1152, :1326, :1368,
  :1416, :1479, :1622, :1733`) — eight production-facing functions default
  `resolvedAt`/`generatedAt`/`now` to the string literal
  `'2026-03-24T00:00:00Z'`. A caller who omits the timestamp gets frozen-clock
  semantics in retention windows, plan-change quota comparisons, and audit
  correlation envelopes.
- **B17** (`services/internal-contracts/src/index.mjs:1620`) —
  `resolveInitialTenantBootstrap` defaults `provisioningRunId` to the literal
  `'prn_bootstrappreview'`. Multiple bootstraps that omit the arg collide on a
  single audit/correlation key.
- **G6** restates B4 with the per-line catalogue; **G7** restates B1 against the
  other URL-builder branch at `:1180` (which already uses
  `environmentProfile.hostnames.api` correctly).

## What Changes

- Remove the hard-coded `'2026-03-24T00:00:00Z'` default from all eight
  signatures; require callers to pass `resolvedAt`/`generatedAt`/`now`
  explicitly, and throw `MissingClockError` when omitted.
- Replace the literal `example.com` hostname in
  `getWorkspaceApplicationBaseUrl` with a value sourced from
  `environmentProfile.hostnames.workspaceApplicationBase` (same source the
  other branch already uses); throw if the profile lacks the field.
- Replace the literal `'prn_bootstrappreview'` default for
  `provisioningRunId` with a required argument; throw when omitted.

## Capabilities

### Modified Capabilities

- `deployment-and-operations`: requirement on registry-level defaults — no
  literal hostnames, no frozen clocks, no shared correlation ids.

## Impact

- **Affected code**: `services/internal-contracts/src/index.mjs` (eight
  signatures + `getWorkspaceApplicationBaseUrl` + `resolveInitialTenantBootstrap`);
  every of the 50 importers that called the affected functions without the
  newly-required args.
- **Migration required**: contract registry must add
  `hostnames.workspaceApplicationBase` to every entry in
  `deployment-topology.json` for environments listed in
  `optional_workspace_subdomain.allowed_environments`.
- **Breaking changes**: callers that previously relied on the implicit
  `'2026-03-24T00:00:00Z'` clock or the implicit `'prn_bootstrappreview'` run
  id will now throw — intended.
