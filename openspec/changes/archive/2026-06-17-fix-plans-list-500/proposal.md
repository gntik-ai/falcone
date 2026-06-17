# fix-plans-list-500

## Change type
bug-fix

## Capability
quotas-plans (cap-quotas-plans)

## Priority
P2

## Why (Problem Statement)
`GET /v1/plans` (superadmin endpoint) returns 500. The provisioning-orchestrator's
`plan-list` action is erroring. The entitlement and consumption sub-routes respond
correctly, so the issue is isolated to plan catalog listing.

**Evidence (live campaign 2026-06-17):**
- `GET /v1/plans` → 500 (F3 in the campaign report).
- Entitlement routes: working.

## What Changes
Identify and fix the error in the `plan-list` action of the provisioning-orchestrator.
Likely candidates: missing DB migration (relation not found), incorrect query, or
missing permission grant.

## Impact
- **Functional:** superadmin cannot see the plan catalog via the API/console.
- **Breaking change:** none.
- **Dependencies:** none known.
