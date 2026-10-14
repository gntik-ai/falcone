# Accept control-plane tenant owners on current-plan reads

## Why

Issue #1154 reports that GET `/v1/tenant/plan` (M7) and own-tenant GET
`/v1/tenants/{tenantId}/plan` (M8) return FORBIDDEN for real tenant owners.
The control plane maps realm roles `tenant_owner` and `tenant_admin` to actor
type `tenant_owner`, while the action accepts only `tenant-owner` and
`superadmin`. This blocks the downstream #1095 work.

## What changes

- Use one owner-type set in `plan-assignment-get.mjs` authorization for both
  `tenant_owner` and `tenant-owner`. Every owner passes the same tenant equality
  check before the assignment repository reads the database.
- Keep superadmin access, missing identity and tenant errors, error shapes,
  and status mapping unchanged. Literal actor types `tenant_admin` and `tenant`
  remain denied; mapped tenant admins arrive as `tenant_owner`.
- Exercise the runtime route table, real module and `invokeRoute` with a
  database boundary fixture, covering own reads and rejection without queries.
- Correct only the two stale runtime route notes. The route catalog already
  describes tenant-owner own-scope access and needs no edit.

## Scope and risk

R3: this widens own-tenant read access. Cross-tenant owners and denied actor
types must fail before any database query. Human approval and independent
verification by both providers remain delivery gates. This maker invocation
does not supply those approvals or runtime release evidence.

Only the action's `authorize()` function, runtime notes, regression suite and
this change folder are changed. No deployment repository, Helm values, image
pins, route auth fields, dispatcher or server changes are required. There is
no data migration. Rollback reverts the source commit and restores the previous
immutable image digest through the normal release process.

## Survey and follow-ups

`packages/provisioning-orchestrator/src/actions/plan-get.mjs:8` (GET
`/v1/plans/{planIdOrSlug}`) and
`packages/provisioning-orchestrator/src/actions/plan-limits-tenant-get.mjs:5`
(GET `/v1/tenant/plan/limits`) also accept only the hyphenated owner spelling.
They are outside M7/M8 and require separate issues; they are not fixed here.
Whether to file those follow-up issues before #1095 lands remains a
control-plane decision.
