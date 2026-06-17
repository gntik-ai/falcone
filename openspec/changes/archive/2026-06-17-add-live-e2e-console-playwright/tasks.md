# Tasks — add-live-e2e-console-playwright

## Implementation
- [x] Authored `tests/e2e/specs/console/tenant-admin-journey.spec.ts` — a real-browser console E2E:
  - `us-console-smoke` (no creds): loads the console and asserts the login form renders.
  - `us-console-01` (credentialed): logs in via the UI, creates a tenant through the
    CreateTenantWizard (Nombre → Plan → Región), and asserts it appears in the console list AND in
    `GET /v1/tenants` (API parity).
  - `us-console-02` (credentialed): cross-tenant isolation — tenant A reading tenant B's
    workspaces is denied 403.
- [x] Selectors taken from source (`apps/web-console/src`): login at `/login` (LoginPage —
  `input[name=username|password]`, `button[type=submit]`); tenants at `/console/tenants`
  ("Nuevo tenant" → CreateTenantWizard).
- [x] Added a `console` Playwright project (system Google Chrome via `E2E_CHROME_BIN`, since the
  bundled Chromium does not support ubuntu 26.04).
- [x] Credentials are read from env (`E2E_CONSOLE_USER`/`E2E_CONSOLE_PASSWORD`), never hard-coded;
  the credentialed scenarios SKIP when the password is unset so the suite stays green.

## Verification (LIVE — test-cluster-b, 2026-06-17)
- [x] Discovered the deployed console serves the SPA and PROXIES `/v1/*` to the API
  (`GET /v1/tenants` → 401, i.e. reached the API) — no request rewriting needed.
- [x] Confirmed the system Google Chrome harness works on the host and the console is
  browser-functional: **`us-console-smoke` PASSES live** (login form renders at `/login`).
- [x] Confirmed the current console source builds (vite build OK) and routes the full
  Login/Console app (the `/` landing page is a separate public route).
- [x] `us-console-01` (credentialed) — RAN live with the operator-provided superadmin credential.
  Login + navigation + the full CreateTenantWizard (Nombre → Plan → Región → Resumen → Confirmar)
  drive correctly; the wizard POSTs `/v1/tenants`. The first run surfaced a real platform bug (see
  Finding); after that fix (`fix-console-create-tenant-plan`) was applied + redeployed, **us-console-01
  PASSES live** — the tenant is created (201) and appears in the console list AND `GET /v1/tenants`.
- [ ] `us-console-02` (cross-tenant) — authored; gated on seeded tenant tokens (E2E_TENANT_*) so it
  skips otherwise. (Console-path cross-tenant isolation is independently verified — campaign §5
  request-path 403s + the P0 executor api-key IDOR fix.)

## Finding (surfaced by this E2E — FIXED)
- **Console create-tenant → 502.** `POST /v1/tenants` from the CreateTenantWizard sends
  `planId: "starter"` (a plan SLUG, hard-coded in the wizard's PlanStep), but createTenant's
  `assignPlan` saga step (deploy/kind/control-plane/b-handlers.mjs → the real plan-assign action)
  treated planId as a plan UUID → `invalid input syntax for type uuid: "starter"` → 502
  CREATE_TENANT_FAILED, rolling the tenant back. **Fixed in `fix-console-create-tenant-plan`**
  (best-effort, slug-aware plan assignment). Follow-up (separate): wire the wizard's PlanStep to the
  real `/v1/plans` catalog so an operator picks a plan that exists.

## Archive
- [x] `/opsx:archive add-live-e2e-console-playwright` — suite delivered; the browser harness and the
  primary acceptance (`us-console-01`: create a tenant via the UI → list + API) are live-green.
  `us-console-02` is authored + token-gated.
