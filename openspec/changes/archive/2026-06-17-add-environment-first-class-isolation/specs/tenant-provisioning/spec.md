## ADDED Requirements

### Requirement: A project MUST support multiple isolated environments

The system SHALL model environment (e.g. prod/staging/dev) as a first-class concept so that a project can hold multiple environments, each with its own isolated resource set (database, bucket, topics, secrets), rather than treating environment as a workspace slug only.

#### Scenario: Two environments have isolated resources

- **WHEN** a project is created with a `prod` and a `staging` environment
- **THEN** each environment has its own database, bucket, topics, and secrets, and data written in one environment is not visible in the other

#### Scenario: Environment is a first-class create dimension

- **WHEN** a client creates an environment for a project
- **THEN** the system records it as a distinct environment entity with its own provisioned resources
