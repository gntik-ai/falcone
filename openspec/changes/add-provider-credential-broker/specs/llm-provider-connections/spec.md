# LLM provider connections: brokered credentials

## ADDED Requirements

### Requirement: Brokered provider credentials

The executor SHALL accept optional `auth` on collection POST, item PUT and legacy
singular PUT. Missing/null auth and `{ "mode": "apiKey" }` retain the existing
secret resolution, adapter headers and error behavior.

OAuth2 configuration SHALL use `mode: oauth2`, `grantType: client_credentials` or
`refresh_token`, `tokenEndpoint`, `clientId`, and `clientSecretRef`. The refresh
grant additionally requires `refreshTokenRef`. Optional `scopes` is an array of
scope strings and `audience` is a string. Secret refs use exactly one of `name`
(an allow-listed BYOK environment variable) or `workspaceSecret` (the scoped,
read-only OpenBao workspace store). Plaintext auth fields SHALL be rejected.

Workload identity configuration SHALL use only `mode: workloadIdentity` and
`profile`. Operators supply `LLM_IDENTITY_PROFILES` as a JSON object keyed by
profile name. Each profile has `tokenEndpoint`, `audience`, `tenantAllowList`,
optional `tokenFile`, and optional `grantType: token-exchange` (default) or
`jwt-bearer`. The default file is
`/var/run/secrets/falcone/llm-identity/token`. Only operators choose the token file,
exchange endpoint and audience. The exchange uses RFC 8693 subject-token fields,
or the JWT bearer grant with an assertion, respectively. No cloud-specific STS
response formats are implied.

#### Scenario: Token refreshed before expiry

- WHEN a connection's cached access token has less than the expiry skew remaining
- THEN the next preparation SHALL obtain a fresh token using one shared in-flight
  exchange, without aborting provider requests already using the old token.
- AND `LLM_PROVIDER_TOKEN_SKEW_SECONDS` SHALL configure the skew, defaulting to 60.

#### Scenario: Revocation takes effect

- WHEN the endpoint rejects a grant (including invalid_grant, invalid_client and
  unauthorized_client), or a just-acquired token receives provider 401/403
- THEN the executor SHALL clear the cache entry and return non-retryable 424
  `LLM_PROVIDER_AUTH_FAILED` using a fixed message, without echoing response bodies.
- AND streaming failures SHALL occur before committing SSE headers.
- WHEN a cached token receives 401, the broker SHALL invalidate it and re-acquire
  once before exposing response bytes; a second 401 SHALL fail closed.

#### Scenario: Refresh token rotation

- WHEN a refresh response includes a different refresh_token
- THEN it SHALL be discarded, the cache cleared, and the request failed with 424
  `LLM_PROVIDER_AUTH_FAILED`. Rotation and OpenBao writeback are unsupported.

#### Scenario: Transient identity-provider failure

- WHEN the token endpoint is unavailable, returns 5xx, or exceeds a 30-second
  exchange deadline (including response body consumption)
- THEN the executor SHALL evict the entry and return retryable 503
  `LLM_PROVIDER_UNAVAILABLE` with a fixed message.
- WHEN the endpoint returns an unreadable JSON response or more than 64 KiB
- THEN the executor SHALL return retryable 502 `LLM_PROVIDER_RESPONSE_INVALID`
  without retaining the response or emitting its contents.
- AND request-time endpoint confinement failures SHALL remain non-retryable 424
  `LLM_PROVIDER_AUTH_FAILED`; configuration-time failures SHALL remain 400.
- AND an unresolved secret during a cached-token 401 recovery SHALL retain 500
  `LLM_PROVIDER_SECRET_UNRESOLVED` rather than becoming a provider network error.

### Requirement: Credential confinement and identity isolation

Token endpoints SHALL pass assertEndpointAllowed at configuration write and again
before exchange. Secret refs SHALL pass assertSecretRefAllowed at write and at
request preparation. Rejected configuration SHALL write no row and return 400.
Workspace-secret existence checks SHALL retain the current store errors.

A workload profile SHALL explicitly allow the verified tenant. Unauthorized
profile writes SHALL return 400 `LLM_IDENTITY_PROFILE_NOT_ALLOWED`; already-stored
rows SHALL return 422 without exchanging a token. An unavailable or empty
projected token file SHALL fail closed with 500 `LLM_PROVIDER_SECRET_UNRESOLVED`.

Brokered requests SHALL use Authorization: Bearer, including Anthropic and Gemini.
API-key requests SHALL keep their provider-native headers. Client secrets, refresh
tokens and service-account assertions SHALL never be retained in the token cache.
No token/secret value SHALL enter connection rows, batch snapshots, responses,
usage records, audit records, logs or error messages.

#### Scenario: Configuration rejected before persistence

- WHEN a token endpoint or secret reference fails confinement at configuration time
- THEN the write SHALL return 400 and SHALL NOT write a connection row.
- WHEN a workload profile does not allow the verified tenant
- THEN writes SHALL return 400 `LLM_IDENTITY_PROFILE_NOT_ALLOWED`, and requests
  against already-stored rows SHALL return 422 without any token exchange.

#### Scenario: Secret values remain confined during failures

- WHEN a revoked grant, rejected bearer, or missing projected token fails a request
- THEN responses, persisted rows, usage records and captured logs SHALL contain
  only configuration references and fixed errors, never credential values.

### Requirement: Cache identity and rollout

Cache keys SHALL include tenant, workspace, connection and configuration version.
PUT and DELETE SHALL evict local entries; other replicas SHALL read the new
version and SHALL NOT reuse a token acquired under an older version. Brokered
batch snapshots SHALL carry only auth configuration and version, and fail closed
if the connection's auth, endpoint or provider type has changed, or it has
disappeared. Existing API-key batch snapshot behavior SHALL remain unchanged.

#### Scenario: Metadata edits preserve paid batches

- WHEN a brokered batch's connection receives a display name, model allow-list,
  default model or default-selection edit
- THEN polling, result ingestion and cancellation SHALL retain the batch snapshot
  and SHALL acquire credentials under the connection's current version.
- AND credentials cached under a previous version SHALL NOT be reused.
- AND cache activity SHALL prune expired entries and superseded connection versions
  without aborting requests already prepared with an older bearer.

#### Scenario: Worker before and after migration

- WHEN the worker reads before migration
- THEN its SELECT-only path SHALL work against existing registry rows, with absent
  auth meaning API-key mode and no worker DDL.
- WHEN the startup migration runs
- THEN nullable auth/version columns SHALL be added, existing rows SHALL retain
  their API-key configuration, and migration SHALL remain idempotent.
- WHEN an old executor reads a non-API-key connection
- THEN its secret_ref SHALL be null so its confined resolver fails closed before
  provider I/O.
- WHEN an old executor writes a valid API-key secret_ref through the legacy table
  or the immediately previous registry's item PUT
- THEN new readers SHALL treat that connection as API-key mode. Registry writes
  may leave stale additive auth columns in the database; a restored secret_ref
  SHALL take precedence because all brokered writes clear secret_ref.

Tokens are cached per replica, never in PostgreSQL. Revocation cannot be detected
until refresh or provider rejection; the worst-case lag is the provider token TTL.
Disable profiles and roll back the image to roll back workload identity. Brokered
rows then fail closed; additive schema columns need no reversal.
