## ADDED Requirements

### Requirement: Promote a workspace definition across environments

The system SHALL provide a first-party, tenant-scoped operation to promote a source workspace's promotable definition (its registered functions) into a target workspace that belongs to a DIFFERENT environment of the SAME tenant. The operation SHALL copy the function registry only, SHALL NOT copy secrets, credentials, service accounts, or database data, and SHALL NOT mutate the source workspace.

#### Scenario: Promote functions from dev to prod

- **WHEN** an owner promotes a source workspace (environment `dev`) into a target workspace (environment `prod`) of the same tenant
- **THEN** every source function whose name does not already exist in the target is registered in the target, the source workspace is unchanged, and no secrets, credentials, or service accounts are copied

#### Scenario: Promotion is repeatable and never overwrites the target

- **WHEN** a promotion is run a second time, or a source function name already exists in the target
- **THEN** the already-present function is skipped and reported under `skipped`, the target is not overwritten, and the operation still succeeds

#### Scenario: Promotion is tenant-isolated on both ends

- **WHEN** the source or the target workspace belongs to another tenant, or does not exist
- **THEN** the operation returns 404 with no existence leak and copies nothing

#### Scenario: Target must be in the requested target environment

- **WHEN** the target workspace's environment does not match the requested target environment, or the requested target environment equals the source environment
- **THEN** the promotion is rejected (409 environment mismatch, or 400 same environment) and nothing is copied
