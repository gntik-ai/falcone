# web-console Specification (delta)

## ADDED Requirements

### Requirement: IAM Access alerts do not echo upstream internals

The console SHALL render IAM Access mutation failures as friendly localized alerts and SHALL NOT echo
raw backend or upstream Keycloak admin details, including raw `keycloak <METHOD> /realms/...` strings,
realm identifiers in URL form, internal Keycloak admin URLs, or upstream response bodies.

#### Scenario: Upstream Keycloak 404 on an IAM Access mutation

- **WHEN** a user performs an IAM Access mutation and the backend returns a sanitized IAM domain error
  for an upstream Keycloak 404
- **THEN** the IAM Access page renders a friendly localized alert for the failed IAM operation
- **AND THEN** the alert does not contain a raw `keycloak <METHOD> /realms/...` string
- **AND THEN** the alert does not contain a realm identifier in URL form
- **AND THEN** the alert does not contain the verbatim upstream Keycloak response body.
