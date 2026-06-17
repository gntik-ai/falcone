## ADDED Requirements

### Requirement: Gateway MUST authenticate every data-plane request

The system SHALL require a valid credential (verified JWT or API key) on every public data-plane route at the gateway, and SHALL reject any request that presents no credential with HTTP 401, even when the request carries client-supplied tenant-context headers.

#### Scenario: Unauthenticated request with spoofed tenant header is rejected at the gateway

- **WHEN** a client sends `POST /v1/workspaces/<A_ws>/api-keys` through the gateway with header `x-tenant-id: <A_tenant>` and no `Authorization` header
- **THEN** the gateway returns HTTP 401 and no API key is minted for any tenant

#### Scenario: Valid credential is accepted

- **WHEN** a client sends a data-plane request bearing a valid JWT or API key
- **THEN** the gateway forwards the request and the backend responds with the appropriate success status

### Requirement: Gateway MUST strip client-supplied tenant-context headers

The system SHALL strip inbound `x-tenant-id`, `x-workspace-id`, and `x-auth-subject` headers from client requests at the gateway and SHALL re-inject tenant context only from the verified token claims, so that a client-controlled header can never establish or override tenant identity at the backend.

#### Scenario: Client tenant headers never reach the backend

- **WHEN** an authenticated client sends a request that includes a forged `x-tenant-id` header for another tenant
- **THEN** the gateway discards the client header and the backend receives only the tenant identity derived from the verified credential
