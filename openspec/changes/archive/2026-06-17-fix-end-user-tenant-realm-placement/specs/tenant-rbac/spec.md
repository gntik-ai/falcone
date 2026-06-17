## ADDED Requirements

### Requirement: Self-service signups MUST be created in the tenant's realm

The system SHALL create a self-service signup (`POST /v1/auth/signups {tenantId}`) in the target tenant's `iam_realm` rather than in the shared `in-falcone-platform` realm, and SHALL stamp the user's `tenant_id`/`workspace_id` attributes.

#### Scenario: Signup lands in the tenant realm with tenant claims

- **WHEN** a self-service signup is submitted for tenant `T`
- **THEN** the created user exists only in `T`'s `iam_realm`, carries `tenant_id`/`workspace_id` attributes, and does not appear in `in-falcone-platform`

#### Scenario: Platform realm holds only platform principals

- **WHEN** any number of self-service signups are submitted for tenant `T`
- **THEN** the `in-falcone-platform` realm contains no signup-created end-users
