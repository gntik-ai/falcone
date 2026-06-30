# web-console - spec delta for fix-779-service-account-credential-reveal-copy

## ADDED Requirements

### Requirement: Service-account reveal copy matches current-secret semantics

The system SHALL present the Service Accounts credential-issuance action as a reveal of the current
service-account client secret, not as a one-time or unrecoverable secret. The credential-issuance
dialog SHALL clearly state that it reveals the current client secret and can be shown again while the
credential remains active. The dialog SHALL direct operators to the rotation action when they need to
replace the secret or invalidate tokens minted with the previous secret.

The system SHALL keep the rotation action distinct from reveal: rotation SHALL be presented as the
operation that generates a new secret, replaces the previous one, and invalidates pre-rotation
tokens.

#### Scenario: Tenant owner reveals a service-account credential twice

- **WHEN** a tenant owner reveals a credential for a service account, closes the panel, and reveals
  the credential again
- **THEN** the UI does not claim the secret is one-time or unrecoverable, and explains that the
  current client secret can be shown again and that rotation is required to replace it

#### Scenario: Tenant owner rotates a service-account credential

- **WHEN** a tenant owner rotates a service-account credential
- **THEN** the UI labels the returned value as a newly generated secret and explains that rotation
  replaces the previous secret and invalidates pre-rotation tokens
