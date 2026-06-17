# add-live-e2e-console-playwright

## Change type
enhancement

## Capability
web-console (cap-web-console)

## Priority
P2

## Why
The live campaign confirmed the web console is served and reachable but no Playwright
drive-through was executed (budget consumed by deployment defects). Now that the
platform installs, a full console-admin Playwright suite should be authored and run
to validate API-console parity and UI flows.

## What Changes
Build a real-stack Playwright E2E suite (`tests/e2e/`) that:
1. Drives every console admin action: tenant creation, workspace creation, user
   management, plan/entitlement view, database provisioning, storage bucket management.
2. Validates API-console parity (same operations via REST and via the console UI
   produce the same state).
3. Includes cross-tenant isolation probes (cannot see another tenant's data in the UI).

## Impact
- Validates the full console surface post-deployment.
- Provides regression coverage for all future platform changes.
- **Dependencies:** E.1 and E.2 (plans/metrics 500 fixes) for full console coverage;
  D.1–D.4 for auth flows to work in the browser.
