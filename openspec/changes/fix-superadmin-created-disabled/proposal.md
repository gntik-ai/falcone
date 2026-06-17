# fix-superadmin-created-disabled

## Change type
bug-fix

## Capability
tenant-rbac (cap-token-validation / cap-auth-console)

## Priority
P2

## Why (Problem Statement)
The bootstrap superadmin user is created with `enabled: false` (and possibly
`requiredActions` set), so it cannot log in on a fresh install. The workaround
(manual enable via Keycloak admin) defeats the purpose of automated provisioning.

**Evidence (live campaign 2026-06-17):**
- Login → 401 `Account disabled`
- After manual `PUT enabled=true` → login succeeds.
- A1 in the campaign report.

## What Changes
Create the superadmin user with `enabled: true`, `emailVerified: true`, and
`requiredActions: []` in the bootstrap payload.

## Impact
- **Operational:** every fresh install requires a manual fix step to use the platform.
- **Breaking change:** none.
- **Dependencies:** pairs with D.1 for a fully functional fresh install.
