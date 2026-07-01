# iam-admin Specification (delta)

## ADDED Requirements

### Requirement: API errors do not leak internal/upstream details

The system SHALL return IAM mutation errors with a stable caller-safe `code` and sanitized human
`message` that does NOT contain internal Keycloak admin URLs, the admin request line, realm
identifiers in URL form, or the verbatim upstream Keycloak response body. Keycloak-admin-backed
handlers SHALL retain server-side diagnostics for operators without serializing upstream request
paths or response bodies into client-facing error envelopes.

#### Scenario: Upstream Keycloak 404 on a mutation

- **WHEN** a Keycloak admin call inside an IAM or other kc-admin-backed handler returns non-2xx
- **THEN** the API returns a sanitized domain error with a stable `code` and caller-safe `message`
- **AND THEN** the client-facing `message` does not contain internal Keycloak admin URLs
- **AND THEN** the client-facing `message` does not contain a raw `keycloak <METHOD> /realms/...`
  admin request line
- **AND THEN** the client-facing `message` does not contain a realm identifier in URL form
- **AND THEN** the client-facing `message` does not contain the verbatim upstream Keycloak response
  body
- **AND THEN** this holds for superadmin callers and for authenticated tenant owner/admin callers on
  their authorized own-tenant IAM mutations.
