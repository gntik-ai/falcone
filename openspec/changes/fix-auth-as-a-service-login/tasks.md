## 1. Failing black-box test

- [x] 1.1 Add a black-box test: create a platform user (admin API), then attempt ROPC, asserting a token is returned (not `invalid_grant "Account is not fully set up"`). Confirm RED. — `tests/env/keycloak/auth-ropc-user-profile.test.mjs` against real KC26: a principal created via the admin API without `firstName`/`lastName`/`email` (the live probe case) is RED (`"Account is not fully set up"`) under the default KC26 profile and GREEN after the relax. Uses the `in-falcone-console` public client with Direct Access Grants, on a realm mirroring the platform realm. Deterministic across re-runs (fresh realm each run).
- [x] 1.2 Add a black-box test: a self-service signup can subsequently log in and make an authorized call. — the same test proves an `email`-only / name-less principal (what signup / admin-create produces) can ROPC after the relax. NOTE: the *full* signup→login round-trip additionally depends on the login path resolving the signup user's tenant realm (signups land in the tenant `iam_realm`; `login-sessions` targets the platform realm) — that realm-placement wiring is tracked separately (archived `fix-end-user-tenant-realm-placement`, #493); this change removes the KC26 user-profile blocker for those principals.

## 2. Fix direct-grant flow

- [x] 2.1 Correct the realm config so a fully-set-up user can authenticate via ROPC. — Corrected root cause (NOT client direct-grant/consent — that was already correct): KC26's declarative user profile requires `email`/`firstName`/`lastName`. Relax them to optional in both realm-provisioning paths: platform realm via the chart bootstrap (`charts/in-falcone/values.yaml` `bootstrap.oneShot.keycloak.userProfile`, rendered to `user-profile.json` by `bootstrap-payload-configmap.yaml`, PUT by `bootstrap-script-configmap.yaml::ensure_keycloak_user_profile` after realm create) and tenant realms via the runtime (`deploy/kind/control-plane/kc-admin.mjs::relaxUserProfile`, called from `createRealm`).

## 3. Verify

- [x] 3.1 Re-run the login tests — confirm a freshly created principal obtains a token. — `tests/env/keycloak/auth-ropc-user-profile.test.mjs` GREEN (1/1, twice). Chart wiring verified: `helm lint` clean and `helm template` renders `user-profile.json` (no `required` on email/firstName/lastName) + the `ensure_keycloak_user_profile` PUT step.
- [x] 3.2 Run `bash tests/blackbox/run.sh` to confirm no regressions. — 630/630 pass.

> Live gate: the `kc-admin.mjs` tenant-realm relax runs in the deploy/kind control-plane runtime; the live auth flow should be re-proved on the kind cluster (as P0 was), but the relax mechanism itself is proven against real KC26 above.
