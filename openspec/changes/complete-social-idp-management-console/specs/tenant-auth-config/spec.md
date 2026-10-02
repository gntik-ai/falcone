# Tenant auth-config delta

## ADDED Requirements

### Requirement: Tenant social identity-provider management in the console

The console SHALL allow authorized tenant administrators to create, edit, enable/disable and
delete built-in social identity providers. All changes SHALL reach the tenant's Keycloak realm.

#### Scenario: Create from a template

- WHEN a tenant owner/admin creates a known template with client ID and secret
- THEN the PUT returns 200, lists the provider and displays its callback URL or null fallback path

#### Scenario: Write-only secret

- WHEN a secret is submitted or a provider reopened
- THEN no read, PUT response, console state or audit descriptor contains the secret
- AND only clientSecretSet indicates its presence

#### Scenario: Edit preserves credentials

- WHEN an edit omits or empties the client secret
- THEN the stored credentials are retained by read-merge-PUT
- WHEN an edit supplies a non-empty replacement
- THEN the stored secret is replaced

#### Scenario: Validation

- WHEN a template, alias or config key is invalid, or creation lacks credentials
- THEN the server returns 400 VALIDATION_ERROR and performs no Keycloak write

#### Scenario: Tenant role gate

- WHEN a developer, viewer, workspace role or another tenant's owner attempts PUT or DELETE
- THEN the server returns 403 before any Keycloak call
- AND console management controls are shown only to superadmin, tenant_owner and tenant_admin

#### Scenario: Toggle and audit

- WHEN an authorized user enables/disables or edits a provider
- THEN the state persists to Keycloak and tenant.social-provider.upsert records tenant and outcome
- AND audit evidence contains no secret material
