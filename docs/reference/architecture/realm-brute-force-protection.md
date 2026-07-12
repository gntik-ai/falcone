# Realm brute-force protection

Falcone enables Keycloak **brute-force detection** on every realm it provisions — both the per-tenant
realms created by the control-plane and the platform realm created by the Helm chart bootstrap.
Keycloak defaults `bruteForceProtected` to **false**, which means a realm performs no failed-login
throttling: unlimited wrong-password attempts are accepted for evaluation and the attack-detection
counter never increments. Turning detection on closes a password brute-force / credential-stuffing
exposure for tenant end-users and for the console / superadmin login.

When the configured failure factor is exceeded for a user, Keycloak temporarily locks that account
(or, optionally, permanently), so subsequent authentication attempts are throttled rather than
endlessly retried.

## What is enabled

Each provisioned realm carries the following Keycloak `RealmRepresentation` brute-force fields:

| Field | Default | Meaning |
| --- | --- | --- |
| `bruteForceProtected` | `true` | Master switch. When false, every threshold below is inert. |
| `failureFactor` | `10` | Consecutive failed logins before the account is locked. |
| `maxFailureWaitSeconds` | `900` | Maximum temporary lockout window (15 minutes). |
| `waitIncrementSeconds` | `60` | How much the lockout grows per failure beyond the factor. |
| `minimumQuickLoginWaitSeconds` | `60` | Lockout applied for rapid repeated logins. |
| `quickLoginCheckMilliSeconds` | `1000` | Window that defines a "quick" (too-fast) login. |
| `maxDeltaTimeSeconds` | `43200` | Window over which failures are counted (12 hours); after this idle period the failure count resets. |
| `permanentLockout` | `false` | When false, a locked account auto-recovers after the wait window; when true, it stays disabled until an administrator re-enables it. |

The `failureFactor` default is deliberately **10** — stricter than Keycloak's own default of 30
(which is too weak), yet typo-tolerant. It is also intentionally low enough to be practically
verifiable: an operator can confirm lockout with a small number of attempts.

## Configuration

### Per-tenant realms (control-plane)

The control-plane runtime (`apps/control-plane/kc-admin.mjs`) reads the thresholds from
environment variables at startup and stamps them onto each realm it creates. All variables are
optional; an unset, empty, or malformed value falls back to the safe default above, and a malformed
`REALM_BRUTE_FORCE_PROTECTED` keeps protection **on** — detection is disabled only by an explicit,
recognised false (`false`/`0`/`no`/`off`).

| Variable | Default | Maps to |
| --- | --- | --- |
| `REALM_BRUTE_FORCE_PROTECTED` | `true` | `bruteForceProtected` |
| `REALM_BRUTE_FORCE_FAILURE_FACTOR` | `10` | `failureFactor` |
| `REALM_BRUTE_FORCE_MAX_WAIT_SECONDS` | `900` | `maxFailureWaitSeconds` |
| `REALM_BRUTE_FORCE_PERMANENT_LOCKOUT` | `false` | `permanentLockout` |
| `REALM_BRUTE_FORCE_WAIT_INCREMENT_SECONDS` | `60` | `waitIncrementSeconds` |
| `REALM_BRUTE_FORCE_QUICK_LOGIN_WAIT_SECONDS` | `60` | `minimumQuickLoginWaitSeconds` |
| `REALM_BRUTE_FORCE_QUICK_LOGIN_CHECK_MS` | `1000` | `quickLoginCheckMilliSeconds` |
| `REALM_BRUTE_FORCE_MAX_DELTA_SECONDS` | `43200` | `maxDeltaTimeSeconds` |

The kind profile sets the primary knobs in `../falcone-charts/deploy/kind/values-kind.yaml` (the control-plane `env:`
list).

### Platform realm (Helm chart)

The platform realm's brute-force settings live under
`bootstrap.oneShot.keycloak.realm.bruteForce` in `../falcone-charts/charts/in-falcone/values.yaml`, with the same
defaults. Override them per environment in your values file, for example:

```yaml
bootstrap:
  oneShot:
    keycloak:
      realm:
        bruteForce:
          bruteForceProtected: true
          failureFactor: 5
          maxFailureWaitSeconds: 1800
          permanentLockout: false
```

## How existing realms are retrofitted

The chart bootstrap creates the platform realm only when it does not already exist
(`ensure_keycloak_realm` short-circuits once the realm is present). A realm-create payload change
alone would therefore **not** apply brute-force settings to a realm that was provisioned by an
earlier release. To close that gap, the bootstrap script defines an idempotent
`ensure_keycloak_brute_force` step (modeled on the existing `ensure_keycloak_user_profile` relax
step) that PUTs a minimal partial realm representation
(`{"realm": "...", "bruteForceProtected": true, ...}`) onto `/admin/realms/$KEYCLOAK_REALM_ID`
regardless of whether the realm pre-existed. Keycloak's realm PUT merges the provided fields, so the
existing realm's clients, roles, and user profile are left untouched. The step runs on every
bootstrap, right after the user-profile relax step, so an upgrade retrofits the already-provisioned
platform realm.

Per-tenant realms get their settings at creation time, so newly provisioned tenants are protected
immediately; this retrofit path applies to the long-lived platform realm.

## Scope

This is realm hardening / deployment configuration, not a per-tenant API. There is no public API,
SDK, or admin-console surface for these thresholds — they are not exposed through
`setRealmAuthConfig` (the per-tenant login-method toggles). Operators tune them through the
environment variables and chart values above.

## Implementation

- `apps/control-plane/kc-admin.mjs` — `bruteForceRealmConfig(env)` (pure, exported) resolves
  the fields from env; `createRealm` spreads the resolved `DEFAULT_BRUTE_FORCE` into the realm
  representation.
- `../falcone-charts/charts/in-falcone/values.yaml` — the `bootstrap.oneShot.keycloak.realm.bruteForce` defaults.
- `../falcone-charts/charts/in-falcone/templates/bootstrap-payload-configmap.yaml` — lifts the `bruteForce` fields onto
  the realm-create payload and emits `brute-force.json`.
- `../falcone-charts/charts/in-falcone/templates/bootstrap-script-configmap.yaml` — `ensure_keycloak_brute_force`
  (idempotent PUT), invoked after the user-profile relax step.
