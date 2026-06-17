# fix-bootstrap-job-standalone-apisix

## Change type
bug-fix

## Capability
tenant-provisioning (cap-tenant-provisioning)

## Priority
P1

## Why (Problem Statement)
The Keycloak bootstrap Job fails on a fresh kind install during its APISIX-standalone
reconciliation phase, even when the noop-route workaround is in place. As a result,
the platform realm, Keycloak clients (console/gateway), and the superadmin user are
never provisioned — the entire auth layer is absent after install.

**Evidence (live campaign 2026-06-17):**
- Job `falcone-in-falcone-bootstrap` → `Failed`
- Manual `POST /admin/realms` → 201 (realm payload is valid; bootstrap logic is broken)
- After manual workaround: realm + clients + superadmin present and functional

## What Changes
Make the APISIX-standalone reconciliation phase a no-op (or correctly gated as
skipped) when `APISIX_STAND_ALONE=true` so that zero APISIX admin-API calls are
emitted in standalone mode. The bootstrap Job must complete successfully on a fresh
kind install.

## Impact
- **Operational:** without this fix a fresh install is unusable — auth layer is absent.
- **Breaking change:** none.
- **Dependencies:** C.3 (`fix-apisix-gateway-shared-secret-provisioning`) for a fully
  functional APISIX, but the bootstrap fix is independent.
