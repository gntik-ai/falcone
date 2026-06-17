Tracking issue: gntik-ai/falcone#496

## Why

After `POST /v1/auth/signups` returns 201, both `POST /v1/auth/login-sessions` and direct Keycloak ROPC fail with `invalid_grant "Account is not fully set up"`, even though the user is `enabled`/`emailVerified` with `requiredActions:[]` and a password credential. The failure is broader than signup: a user created directly via the Keycloak admin API in `in-falcone-platform` fails the same way, so **no newly-created platform user can authenticate via ROPC** (only the bootstrap `superadmin` works). The realm has no default required actions (`defaultAction=false` for all), so the cause is the realm/client direct-grant flow or `in-falcone-console` consent config.

(Evidence: `tests/live-audit/evidence/09-auth-and-governance.md` plus the D6 probe.) Impact: blocks onboarding of *any* new platform/tenant principal.

## What Changes

- Root cause (corrected after a live KC26 repro — NOT the client direct-grant/consent config, which is already correct: `directAccessGrantsEnabled: true`, public client): Keycloak 26's declarative **user profile** marks `email`/`firstName`/`lastName` REQUIRED for role `user`, so a principal provisioned via the admin API without them fails ROPC with `invalid_grant "Account is not fully set up"` even though `requiredActions:[]`. Relax the realm user profile so those attributes are optional, in both realm-provisioning paths: the chart bootstrap for the platform realm (`bootstrap.oneShot.keycloak.userProfile` + `ensure_keycloak_user_profile`) and the runtime for tenant realms (`kc-admin.mjs::relaxUserProfile`).

## Capabilities

### New Capabilities

### Modified Capabilities

- `tenant-rbac`: A freshly created platform user (and a self-service signup) can complete login, obtain a token, and make an authorized call.

## Impact

- `in-falcone-console` Keycloak client direct-grant flow / consent configuration.
- Login path: `POST /v1/auth/login-sessions` and direct ROPC.
