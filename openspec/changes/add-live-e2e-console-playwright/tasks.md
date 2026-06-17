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
- [ ] `us-console-01` / `us-console-02` (credentialed) — authored and ready; a green run requires the
  superadmin password injected as `E2E_CONSOLE_PASSWORD`. Reading the `in-falcone-superadmin` secret
  into this session is blocked by the environment's credential guardrail, so the credentialed run is
  deferred to an operator-provided credential (the spec runs as-is once it is set, mirroring
  tests/live-campaign/lib/creds.sh).

## Archive
- [ ] `/opsx:archive add-live-e2e-console-playwright` — held until the credentialed scenarios run
  green against the live console (needs an operator-provided `E2E_CONSOLE_PASSWORD`). The suite +
  harness are delivered and the browser path is live-verified (smoke); only the credentialed run is
  outstanding.
