# add-gateway-realtime-config-identity

## Change type
bugfix

## Capability
gateway

## Priority
P1

## Why
The CDC capture list (`GET /v1/realtime/workspaces/{ws}/pg-captures`) and the platform config
catalog reads (`/v1/admin/config/format-versions`, `…/config/export/domains`) 401 for the
callers that should reach them.

**Corrected root cause (verified against code, 2026-06-19).** The original premise — "APISIX does
not run an identity-injection plugin for these paths" — is **incorrect**: the control-plane already
derives the trusted `x-tenant-id` / `x-workspace-id` / `x-actor-*` headers from the verified JWT
itself (`deploy/kind/control-plane/server.mjs` `authenticate()` + injection at the owHeaders step),
so identity injection is not an APISIX gap. The real defects are in the **actions**:

1. **`pg-capture-list`** derived the workspace from the `x-workspace-id` JWT claim
   (`realtime/parse-identity.mjs`) instead of the URL path `{workspaceId}`. A tenant-scoped caller
   (tenant_owner JWT) carries a tenant claim but no per-workspace claim, so `parseIdentity`
   returned null → 401, even though the workspace is right there in the path.
2. **`tenant-config-format-versions`** and **`tenant-config-export-domains`** call
   `parseConfigIdentity`, which required a non-empty `x-tenant-id` *before* inspecting roles. A
   platform **superadmin** carries no own-tenant claim, so these tenant-agnostic / path-addressed
   reads 401'd for the exact principal authorized to call them.

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** superadmin JWT ->
`GET /v1/realtime/workspaces/{ws}/pg-captures` -> 401 'missing identity headers'; the realtime
change-stream (a different, wired route) works.

GitHub issue #611 (epic G). Evidence: `audit/live-campaign/evidence-rerun/15-secrets-metrics-cdc-console-backup.md`.

## What Changes
- `pg-capture-list` addresses the workspace by the URL path (`params.workspaceId`), falling back to
  the `x-workspace-id` header for workspace-scoped credentials. The **tenant** is still taken ONLY
  from the trusted `x-tenant-id` header (anti-spoofing preserved) and the repository read stays
  tenant-scoped, so a workspace id from another tenant yields nothing (no cross-tenant leak).
- `parseConfigIdentity` gains a `requireTenant` option (default `true`, so every existing
  tenant-scoped config action is unchanged). The two tenant-agnostic / path-addressed catalog reads
  call it with `requireTenant:false` and authorize a platform operator (superadmin/sre) or the
  `platform:admin:config:export` scope. A request with **no** trusted identity at all (e.g. a forged
  Bearer JWT and nothing else) still returns null → 401 (anti-spoofing invariant preserved).

- Add migration 080 (`pg_capture_configs` + `pg_capture_quotas` + `pg_capture_audit_log`) to the kind
  governance bootstrap (`GOVERNANCE_MIGRATIONS`). Live verification of the identity fix surfaced a
  SECOND, same-class gap: with the 401 removed, `pg-capture-list` reached its DB read and 500'd with
  `42P01` because the kind bootstrap never created `pg_capture_configs` (migration 080 was listed in
  `required-migrations.txt` but absent from `GOVERNANCE_MIGRATIONS` — same omission as #595's 114).

No APISIX route change is required: `/v1/flows`+`/v1/mcp` gateway routes already exist (archived
#560) and `/v1/realtime/*`/`/v1/admin/config/*` reach the control-plane via the `/v1/*` catch-all.

## Impact
`GET /v1/realtime/workspaces/{ws}/pg-captures` returns the workspace's captures for a tenant-scoped
caller; `/v1/admin/config/format-versions` and `…/export/domains` return business responses for a
platform operator. Cross-tenant access yields no data; unauthenticated requests stay 401.
