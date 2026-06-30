# access-control - spec delta for fix-779-service-account-credential-reveal-copy

## ADDED Requirements

### Requirement: Service-account credential issuance is documented as current-secret reveal

The system SHALL describe service-account `credential-issuance` as revealing or returning the
current client secret for the workspace service account. Public API, route catalog, MCP catalog, and
operator-facing documentation SHALL NOT describe credential issuance as generating a new
secret-free credential reference, nor as a one-time/unrecoverable reveal. The system SHALL describe
service-account credential rotation as the explicit operation that replaces the secret and
invalidates tokens minted with the previous secret.

#### Scenario: Public contract describes credential issuance

- **WHEN** a tenant owner or tool consumer reads the public API surface, generated route catalog,
  OpenAPI operation summary, MCP catalog, or service-account credential lifecycle documentation for
  `credential-issuance`
- **THEN** the route is described as revealing the current client secret, distinct from rotation

#### Scenario: Credential issuance may reveal the same active secret again

- **WHEN** a tenant owner issues/reveals a service-account credential twice without rotating or
  revoking it
- **THEN** the documented behavior permits the same current secret to be returned again, because the
  UI and docs do not promise one-time/unrecoverable semantics
