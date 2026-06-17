# fix-console-create-tenant-plan

## Change type
bug-fix

## Capability
tenant-lifecycle (cap-tenant-lifecycle)

## Priority
P1

## Why (Problem Statement)
A tenant cannot be created through the web console. The CreateTenantWizard's PlanStep submits a
plan **slug** (`planId: "starter" | "growth"`, hard-coded options), but `createTenant`'s `assignPlan`
saga step (`deploy/kind/control-plane/b-handlers.mjs`) passes it straight to the real `plan-assign`
action, which keys on the plan **UUID**. Postgres then rejects the slug:

```
POST /v1/tenants -> 502 CREATE_TENANT_FAILED: invalid input syntax for type uuid: "starter"
```

Because the step throws, the saga rolls the tenant back — so **no tenant is created at all**, even
though plan assignment is documented as *"Optional: assign a plan immediately"* (b-handlers.mjs:120).

**Evidence (live console E2E, test-cluster-b 2026-06-17):** `tests/e2e/specs/console/tenant-admin-journey.spec.ts`
(`us-console-01`) drives the wizard end-to-end; the wizard POSTs `/v1/tenants` with valid auth and
the API returns the 502 above.

## What Changes
Make plan assignment in `createTenant` **best-effort and slug-aware**:
1. Resolve `planId` as slug-or-UUID — if it is not a UUID, look the plan up by slug to get its id.
2. If the plan cannot be resolved or assigned (unknown slug, empty catalog, invalid id, assign
   error), **create the tenant anyway** and report `planAssignment: { assigned: false, reason, … }`
   instead of failing the whole request with a 502 rollback.
3. When the plan resolves, assign it as before and report `planAssignment: { assigned: true, … }`.

This honors the documented "optional plan" intent: a bad/unknown plan never blocks tenant creation.

(Follow-up, separate change: wire the console wizard's PlanStep to the real `/v1/plans` catalog so
operators pick a plan that actually exists.)

## Impact
- **Functional:** tenant creation via the console succeeds (the wizard's slug is tolerated).
- **Breaking change:** none — a valid plan id still assigns; the response gains a structured
  `planAssignment` status.
- **Dependencies:** none.
