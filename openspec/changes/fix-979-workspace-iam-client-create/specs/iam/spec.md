## ADDED Requirements

### Requirement: Workspace tenant realm client creation

POST /v1/workspaces/{workspaceId}/iam/clients SHALL authorize superadmin or the workspace tenant's
owner/admin and derive the realm exclusively from tenant.iam_realm. Body realm, realmId or tenantId
SHALL be rejected with 400 VALIDATION_ERROR. Other callers SHALL receive 403 before Keycloak is
called; unknown workspaces SHALL return 404 WORKSPACE_NOT_FOUND and missing realms 409 NO_REALM.

#### Scenario: Console public client

- **WHEN** an authorized caller submits a valid wizard payload
- **THEN** the API returns 201 with iamClientId, clientId, clientType, realm and workspaceId
- **AND** the re-read client has publicClient and standardFlowEnabled true, direct grants and
  service accounts false, and pkce.code.challenge.method S256
- **AND** no secret is returned

#### Scenario: Confidential or service-account client

- **WHEN** a confidential client is created
- **THEN** publicClient is false, standard flow is true and direct grants are false
- **WHEN** a service_account client is created
- **THEN** service accounts are true, standard flow and direct grants are false, and redirect
  URIs and web origins are empty
- **AND** a secret is returned only in the 201 response with Cache-Control: no-store
- **AND** secrets never appear in replays, audit evidence or logs

### Requirement: Bounded configuration validation

The API SHALL reject missing or malformed clientId, unknown clientType, malformed URI arrays,
wildcards, userinfo (including empty userinfo), fragments and schemes other than HTTPS or HTTP
loopback with 400 VALIDATION_ERROR. Public and confidential clients SHALL require redirect URIs.
Web origins SHALL contain only an origin. Scopes SHALL be offered by the resolved realm; openid
SHALL be accepted implicitly and omitted from Keycloak client scope mappings. Non-empty
permissions SHALL return 400 UNSUPPORTED_FIELD. Unknown body fields SHALL never reach Keycloak.
Requested scopes SHALL be additions to the resolved realm's default client scopes, including when
the wizard selects no scopes. Creation and replay verification SHALL require the merged set.
The client SHALL carry the existing server-owned hardcoded tenant_id mapper for the resolved
realm; caller-defined protocol mappers SHALL never be forwarded.

#### Scenario: Invalid redirect target

- **WHEN** a caller submits a credential-bearing, wildcard or non-loopback HTTP URI
- **THEN** validation fails before client creation

#### Scenario: Wizard retains realm identity defaults

- **WHEN** the wizard submits scopes: [] or selects profile/email already present in realm defaults
- **THEN** the client retains the realm's basic, role and platform context scope mappings
- **AND** an equivalent replay returns the same UUID without another client or secret

### Requirement: Owned idempotent creation

Created clients SHALL carry in-falcone.kind=workspace-iam-client and
in-falcone.workspace-id={workspaceId}. Equivalent replay SHALL return 200 with the same UUID and
no secret. Array order, repeated values and explicit openid SHALL not change equivalence.
Different configuration, missing tags or foreign workspace ownership SHALL return 409
IAM_CLIENT_EXISTS. Requests SHALL serialize within a process and use Keycloak clientId uniqueness
across replicas. A create conflict SHALL be re-read and replayed only if equivalent and owned.

#### Scenario: Concurrent identical requests

- **WHEN** several callers submit the same owned configuration
- **THEN** only one client exists and only its creator can receive a secret

### Requirement: Verified realization and redacted audit evidence

Success SHALL require a full re-read matching the requested identifier, protocol, enabled state,
flow flags, redirect URIs, web origins, scope mappings and ownership tags. Provider failures or
mismatched realization SHALL return a normalized 502 through kcBackedErr and SHALL trigger
best-effort deletion of this attempt's client. A conflict loser SHALL never delete another
attempt's client. No unverified active state SHALL be reported.

Audit evidence SHALL include the actor, target workspace and tenant, redacted requested
configuration, realized UUID or failure code, and compensation result for success and failure.
Credential-bearing invalid URIs and URI query values SHALL be redacted; arbitrary body fields
and Keycloak error diagnostics SHALL not be persisted.

#### Scenario: Compensation is unavailable

- **WHEN** verification fails and the compensation delete also fails
- **THEN** the API reports a provider failure and the audit retains the UUID and failed cleanup
  outcome for operator reconciliation

### Requirement: Real Keycloak consumer coverage

The scheduled integration suite SHALL provision tenant/workspace fixtures through the public
API, submit the wizard payload as tenant owner, verify inventory and replay, complete an auth-code
login with PKCE S256, and reject plain PKCE, direct grants and foreign-tenant creation. Console
tests SHALL assert the request payload and consume iamClientId from the response.

#### Scenario: No operator Keycloak access

- **WHEN** an authorized consumer creates its application client
- **THEN** creation and authentication work using public APIs without operator realm access
- **AND** the wizard's empty scope selection supports an openid auth-code request with S256
- **AND** the access token retains sub, tenant_id, realm roles and the workspace_id of a
  workspace-bound principal, plus the platform context scopes
