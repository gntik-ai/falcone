# Tasks — fix-console-create-tenant-plan

## Investigation
- [x] Root cause confirmed: `createTenant.assignPlan` (b-handlers.mjs) passed a plan slug to the real
  plan-assign action, which casts it to a UUID → 502, and the saga rolled the tenant back.

## Implementation
- [x] `deploy/kind/control-plane/b-handlers.mjs`: plan assignment is now best-effort + slug-aware —
  `assignPlanBestEffort` resolves `planId` (slug→uuid via plan-repository.findBySlug), assigns when
  resolvable, otherwise creates the tenant anyway and returns `{assigned:false, reason, ...}` and
  never throws (the saga step no longer aborts on a non-uuid planId).
- [x] Exported testable helpers `isPlanUuid` + `assignPlanBestEffort` (injectable loaders).

## Verification
- [x] Black-box test `tests/blackbox/tenant-create-plan-besteffort.test.mjs` (bbx-tp-01..05).
- [x] Run `bash tests/blackbox/run.sh` (691/691).
- [x] LIVE (test-cluster-b): rebuilt + redeployed the control-plane (`adv-20260617c`); re-ran
  `us-console-01` — the wizard create now returns **201**, the tenant appears in the console list AND
  `GET /v1/tenants`. The console suite is green (smoke + us-console-01 pass; cross-tenant skipped).
- [x] `openspec validate fix-console-create-tenant-plan --strict`.

## Archive
- [x] `/opsx:archive fix-console-create-tenant-plan`
