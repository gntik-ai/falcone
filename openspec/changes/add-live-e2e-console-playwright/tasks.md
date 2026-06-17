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
  drive correctly and the wizard POSTs `/v1/tenants` with valid auth. **The run surfaced a real
  platform bug** (see Finding below) — the create returns 502 — so the spec correctly fails the
  acceptance until the bug is fixed. (Without creds it skips, so CI stays green.)
- [ ] `us-console-02` (cross-tenant) — gated on seeded tenant tokens (E2E_TENANT_*); skips otherwise.

## Finding (surfaced by this E2E — new bug)
- **Console create-tenant → 502.** `POST /v1/tenants` from the CreateTenantWizard sends
  `planId: "starter"` (a plan SLUG, hard-coded in the wizard's PlanStep), but createTenant's
  `assignPlan` saga step (deploy/kind/control-plane/b-handlers.mjs:122 → the real plan-assign action)
  treats planId as a plan UUID → `invalid input syntax for type uuid: "starter"` → 502
  CREATE_TENANT_FAILED. Net: **a tenant cannot be created through the console UI.** The plan
  assignment is documented as "Optional" (b-handlers.mjs:120) but a failure aborts the whole create
  instead of degrading. Recommend a follow-up fix (resolve planId as slug-or-uuid and/or make plan
  assignment best-effort; and wire the wizard's PlanStep to the real /v1/plans catalog).

## Archive
- [ ] `/opsx:archive add-live-e2e-console-playwright` — held until the credentialed scenarios run
  green against the live console (needs an operator-provided `E2E_CONSOLE_PASSWORD`). The suite +
  harness are delivered and the browser path is live-verified (smoke); only the credentialed run is
  outstanding.
