# app-credentials Specification

## Purpose
TBD - created by archiving change add-app-api-keys. Update Purpose after archive.
## Requirements
### Requirement: Per-workspace ANON and SERVICE API key issuance

The system SHALL allow a workspace admin to mint two distinct key types — ANON
(publishable, browser-safe) and SERVICE (secret, server-only) — for a given
workspace, storing only the SHA-256 hash of each key at rest and returning the
plain-text secret exactly once in the issuance response, so that compromised
storage never leaks usable credentials.

#### Scenario: Mint an ANON key for a workspace

- **WHEN** a workspace admin calls `POST /v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-issuance` with `keyType: "anon"`
- **THEN** the response contains the full plain-text ANON key exactly once, the key record is persisted with only its SHA-256 hash, and a subsequent read of the credential record does not expose the plain-text value

#### Scenario: Mint a SERVICE key for a workspace

- **WHEN** a workspace admin calls the credential-issuance endpoint with `keyType: "service"`
- **THEN** the response contains the full plain-text SERVICE key exactly once, stored only as a hash, and a subsequent read does not expose the plain-text value

#### Scenario: Key value is never present in application logs

- **WHEN** an API key is minted or rotated
- **THEN** no log line, audit event payload, or error response at any layer contains the plain-text key value

### Requirement: Gateway key-auth resolves key to tenant/workspace identity and injects propagated headers

The system SHALL resolve an inbound `apikey` header (or query parameter) on data
and event routes to the owning `tenant_id`, `workspace_id`, DB role, and scope set,
and inject `X-Tenant-Id`, `X-Workspace-Id`, `X-Auth-Scopes`, and `X-Actor-Roles`
headers so that upstream services receive the same identity context as the JWT path.

#### Scenario: Valid ANON key resolves to restricted identity headers

- **WHEN** a client sends a request to a data route with a valid ANON API key in the `apikey` header
- **THEN** the gateway resolves the key to its workspace and injects `X-Tenant-Id`, `X-Workspace-Id`, `X-Auth-Scopes` reflecting the ANON scope set, and `X-Actor-Roles` reflecting the ANON (RLS-governed) DB role

#### Scenario: Valid SERVICE key resolves to elevated identity headers

- **WHEN** a client sends a request to a data route with a valid SERVICE API key in the `apikey` header
- **THEN** the gateway injects `X-Actor-Roles` reflecting the elevated SERVICE DB role and `X-Auth-Scopes` reflecting the full SERVICE scope set

#### Scenario: Unknown or malformed key is rejected

- **WHEN** a client sends a data route request with an `apikey` value that does not match any stored key hash
- **THEN** the gateway returns 401 and the request does not reach the upstream service

### Requirement: Revoked key is rejected at the gateway

The system SHALL reject any request that carries a key whose `revoked_at` timestamp
is set, regardless of whether the hash otherwise matches a stored record.

#### Scenario: Revoked key returns 401

- **WHEN** a workspace admin revokes a key via `POST /v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-revocations` and a client subsequently presents that key
- **THEN** the gateway returns 401 and the upstream service does not receive the request

### Requirement: Key rotation issues a new secret and invalidates the previous one

The system SHALL, on a rotate operation, generate a new key secret, persist its
hash, and mark the previous key hash as revoked atomically, so that there is never
a window in which both the old and new secrets are simultaneously valid after
rotation completes.

#### Scenario: Rotation issues a new secret and invalidates the old

- **WHEN** a workspace admin calls `POST /v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-rotations`
- **THEN** a new plain-text key is returned once, the old key hash is marked revoked, and any subsequent request using the old key returns 401

### Requirement: Scope enforcement rejects requests missing required scopes

The system SHALL, when `SCOPE_ENFORCEMENT_ENABLED` is active on a data route,
compare the scopes carried in `X-Auth-Scopes` against the route's `required_scopes`
and reject requests that do not satisfy them.

#### Scenario: ANON key missing a required scope returns 403

- **WHEN** a client uses a valid ANON key to call a route that requires a scope not included in the ANON key's scope set
- **THEN** the gateway returns 403 with an indication that a required scope is absent

#### Scenario: SERVICE key with sufficient scopes succeeds

- **WHEN** a client uses a valid SERVICE key whose scope set includes all scopes required by the target route
- **THEN** the request proceeds normally and the upstream service receives the injected identity headers

### Requirement: Per-key rate limiting enforces a request budget

The system SHALL apply a per-key `limit-count` rate limit in APISIX so that a
single API key cannot exceed its configured request budget within the rate-limit
window, independent of the tenant-level `qosProfile` limit.

#### Scenario: Requests beyond per-key budget return 429

- **WHEN** a client sends requests using a single API key at a rate that exceeds the key's configured `rateLimitBudget` within the current window
- **THEN** the gateway returns 429 for requests beyond the budget until the window resets, and requests within budget succeed normally

### Requirement: ANON key is restricted to RLS-governed rows only

The system SHALL map the ANON key to a DB role that is subject to Row-Level
Security policies, so that a browser holding an ANON key can only read rows
that the RLS policy for that workspace permits.

#### Scenario: ANON key read is filtered by RLS

- **WHEN** a browser client sends a data-read request using a valid ANON key for workspace W
- **THEN** the response contains only rows that the workspace W RLS policy permits for the ANON role, and rows belonging to other workspaces or tenants are not present in the response

#### Scenario: ANON key cannot access rows outside its workspace

- **WHEN** two workspaces W1 and W2 exist under the same tenant and a client uses W1's ANON key to query a data route
- **THEN** the response contains no rows owned by W2

