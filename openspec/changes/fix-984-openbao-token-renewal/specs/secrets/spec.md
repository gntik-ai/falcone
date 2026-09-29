## ADDED Requirements

### Requirement: Secret-backend session management

The control plane SHALL start Kubernetes authentication when the configured secret store is created. It SHALL renew renewable OpenBao tokens after more than half their lease has elapsed and before expiration. It SHALL re-authenticate when renewal fails or cannot extend the lease. Auth requests SHALL be serialized and failed re-logins SHALL use bounded exponential backoff with jitter.

#### Scenario: Renewal succeeds

When a renewable token passes half its lease, the provider calls `auth/token/renew-self` with its token and namespace and updates its expiry from the returned lease without another login.

#### Scenario: Renewal cannot maintain the lease

When renewal fails or does not extend expiry, the provider re-logs in before the previous lease ends. If re-login fails, it reports degradation and retries with bounded backoff.

#### Scenario: KV request rejects a provider token

When a KV request returns 403, the client invalidates the rejected provider token, re-logs in, and retries the KV request once. A second failure retains the existing route error contract.
Repeated 403 responses after a fresh login SHALL rate-limit further invalidation attempts to bound token creation during a persistent policy denial.

### Requirement: Secret-backend authentication health

The control plane SHALL expose a read-only backend health snapshot with state, last success and failure times, last failure HTTP status, consecutive failures, and token expiry. It SHALL report the first login failure promptly, recover state after successful login or renewal, and omit tokens, JWTs, and secret values from all health, metrics, logs, and errors. An unconfigured backend SHALL report disabled with no auth timer.

#### Scenario: Authentication fails at startup

When Kubernetes login is refused, health and readiness bodies show a degraded secret backend, a bounded metric reports the failure, and a structured log contains the role, auth mount, status, and failure count.

#### Scenario: Backend is unconfigured

When the store is not configured, health and readiness bodies show the backend as disabled and no auth timer starts.

#### Scenario: Database is healthy during a secret-backend outage

When Postgres is healthy but secret-backend auth is degraded, `/healthz` and `/readyz` return HTTP 200 with the degraded state in their bodies. When Postgres is unavailable, they return HTTP 503.
