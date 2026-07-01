# Tasks - fix-748-create-tenant-plan-assignment

## 1. Reproduce / root cause

- [x] Confirm the issue root cause in `CreateTenantWizard.tsx`: the Plan step hardcoded
  `starter` / `growth`, did not call the plan catalog API, required `planId`, and posted the literal
  selected value to `POST /v1/tenants`.
- [x] Inspect the backend create path: `deploy/kind/control-plane/b-handlers.mjs` already calls
  `assignPlanBestEffort` from `POST /v1/tenants` when `body.planId` is present, so the assignment
  half is already implemented for resolvable plan IDs/slugs.

## 2. Fix

- [x] Update the wizard to load active catalog plans with
  `listPlans({ status: 'active', page: 1, pageSize: 100 })`.
- [x] Render only real catalog plans in the Plan step and use the plan record ID as the `<option>`
  value.
- [x] Remove phantom hardcoded Starter/Growth options.
- [x] Block progression with accessible loading, error, and empty-catalog states instead of allowing
  a fabricated selection.
- [x] Continue submitting `planId` to `POST /v1/tenants`, now carrying the selected real plan ID.

## 3. Tests

- [x] Update `CreateTenantWizard.test.tsx` so the regression test proves the wizard fetches real
  active catalog plans, lets the operator select a real catalog plan ID, posts that ID to
  `/v1/tenants`, and does not offer the hardcoded phantom options.
- [x] Add empty-active-catalog coverage for the Plan step disabled state.
- [x] No backend test was added because the backend path was unchanged and already contains the
  creation-time `assignPlanBestEffort` assignment call.

## 4. Contract / docs / OpenSpec

- [x] No backend/API contract artifacts changed; the route and request field stay
  `POST /v1/tenants` with `planId`.
- [x] Materialize this OpenSpec change under
  `openspec/changes/fix-748-create-tenant-plan-assignment/`.
- [x] Add a concise reference doc for create-tenant plan catalog selection and assignment behavior.

## 5. Verify

- [x] Run the focused web-console wizard test:
  `pnpm --filter @in-falcone/web-console test -- CreateTenantWizard.test.tsx`
- [x] Run OpenSpec validation if available:
  `openspec validate fix-748-create-tenant-plan-assignment --strict`
- [x] Review the final diff and commit on `fix/748-create-tenant-plan-assignment`.
