# realtime Specification

## Purpose
TBD - created by archiving change fail-closed-realtime-auth-flag. Update Purpose after archive.
## Requirements
### Requirement: Realtime service refuses to start in production when auth is disabled

The system SHALL throw a configuration error during startup (`loadEnv`) if `REALTIME_AUTH_ENABLED=false` and `NODE_ENV=production`, before any WebSocket or SSE listener is opened. The system SHALL NOT silently proceed to accept subscriptions with auth disabled in a production environment.

#### Scenario: Service startup is rejected when auth disabled in production

- **WHEN** the realtime-gateway process starts with `REALTIME_AUTH_ENABLED=false` and `NODE_ENV=production`
- **THEN** the process exits with a non-zero status and an explicit configuration error before accepting any connections

#### Scenario: Service starts normally in production with default auth enabled

- **WHEN** the realtime-gateway process starts with `REALTIME_AUTH_ENABLED=true` and `NODE_ENV=production`
- **THEN** the service starts successfully and accepts WebSocket or SSE connections as usual

### Requirement: The auth bypass block never returns an empty subscriptionContext

The system SHALL ensure that no code path in `validate-subscription-auth` returns `{ allowed: true, subscriptionContext: {} }`. If a development-only bypass is retained, it MUST be gated to `NODE_ENV !== 'production'` AND MUST supply a non-empty `subscriptionContext` containing at minimum a dev-tenant `tenantId`.

#### Scenario: Auth bypass returns non-empty subscriptionContext in dev mode

- **WHEN** the realtime-gateway runs with `REALTIME_AUTH_ENABLED=false` and `NODE_ENV=development`
- **THEN** `validate-subscription-auth` returns `{ allowed: true, subscriptionContext: { tenantId: <dev-tenant>, ... } }` where `subscriptionContext` is not an empty object

#### Scenario: Auth bypass is absent in production paths

- **WHEN** the realtime-gateway runs with `NODE_ENV=production`
- **THEN** the bypass block at `validate-subscription-auth.mjs:34-37` is not reachable regardless of the value of `REALTIME_AUTH_ENABLED`

### Requirement: Normal realtime auth path is unmodified when auth is enabled

The system SHALL leave all behavior of `validate-subscription-auth` unchanged when `REALTIME_AUTH_ENABLED=true`, including JWT signature verification, scope/workspace access checks, filter validation, complexity limits, quota enforcement, and audit-event publication.

#### Scenario: Full auth path executes with auth enabled

- **WHEN** a subscription request arrives and `REALTIME_AUTH_ENABLED=true`
- **THEN** `validateTokenFn`, `checkScopesFn`, filter validation, complexity limits, `countActiveSubscriptions`, and audit-event publication all execute on every subscription attempt

#### Scenario: Rejected subscription with auth enabled returns 403/401 not a bypass allow

- **WHEN** a subscription request arrives with an invalid or expired JWT and `REALTIME_AUTH_ENABLED=true`
- **THEN** `validate-subscription-auth` returns `{ allowed: false }` or throws, and the subscription is denied

