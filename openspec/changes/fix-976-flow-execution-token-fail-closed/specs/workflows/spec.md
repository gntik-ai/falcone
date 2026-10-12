## ADDED Requirements

### Requirement: Execution-token trust is fail-closed and uniformly enforced

The system SHALL refuse to mint or validate flow execution credentials with an absent, empty,
or shorter-than-32-byte signing secret in production. Every registered task activity SHALL
validate a scoped execution token before invoking its activity. The development key SHALL be
available only outside production.

#### Scenario: Production signing secret is unavailable

- **WHEN** NODE_ENV is production and FLOW_EXECUTION_TOKEN_SECRET is missing, empty, or weak
- **THEN** executor minting SHALL fail with EXECUTION_TOKEN_SECRET_UNCONFIGURED before any start
- **AND** the flow-start API SHALL return 503 without exposing credential material
- **AND** worker validation SHALL fail non-retryably and SHALL never accept a forged dev-key token

#### Scenario: Production signing secret is configured

- **WHEN** a production secret has at least 32 UTF-8 bytes
- **THEN** configured-key tokens SHALL round-trip between executor and worker
- **AND** dev-key tokens SHALL fail with EXECUTION_TOKEN_INVALID

#### Scenario: Missing credential on a registered task

- **WHEN** a registered task receives a missing or null executionToken
- **THEN** dispatch SHALL fail non-retryably with EXECUTION_TOKEN_INVALID before activity invocation
- **AND** unregistered echo tasks SHALL retain their existing behavior

#### Scenario: A schedule fires after its registration is more than 24 hours old

- **WHEN** a Temporal schedule fires with legacy tokenless tenant-envelope args
- **THEN** a worker activity SHALL verify this run's server-recorded schedule ID against its owner
- **AND** mint a fresh token for the owner's tenant and workspace at or after this firing
- **AND** expiry SHALL be no later than firing time plus DEFAULT_MAX_RUN_DURATION_MS
- **AND** the deterministic interpreter SHALL carry that token into registered activities

#### Scenario: Foreign cron envelope

- **WHEN** a cron envelope names a foreign tenant, workspace, or flow
- **THEN** minting SHALL fail non-retryably with EXECUTION_TOKEN_TENANT_MISMATCH or
  EXECUTION_TOKEN_INVALID and yield no valid token

#### Scenario: Credential persistence and deployment

- **WHEN** a cron Schedule is registered or a run is started
- **THEN** execution tokens SHALL be absent from persisted Schedule args, memo, and search attributes
- **AND** both production workloads SHALL receive the same OpenBao/ESO-managed signing Secret
  through secretKeyRef, with no literal signing secret in chart values or templates
