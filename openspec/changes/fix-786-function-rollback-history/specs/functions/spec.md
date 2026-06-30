# functions — spec delta for fix-786-function-rollback-history

## ADDED Requirements

### Requirement: Function rollback works and UI is consistent

The system SHALL retain function action version history durably enough for rollback and SHALL keep
function detail, function version listing, rollback behavior, and the web console's rollback controls
consistent with that retained history.

For the kind control-plane function action plane, the system SHALL snapshot every successful
function create and update into retained version history. Version list responses SHALL use
contract-shaped `versionId` values matching `^fnv_[0-9a-z]+$`, SHALL identify the active version,
SHALL retain historical versions, and SHALL mark `rollbackEligible` true only for retained prior
versions. Function detail SHALL report `rollbackAvailable` only when at least one retained prior
version is actually eligible.

Existing function rows that predate retained history SHALL remain readable. They MAY produce a
synthetic active version row for display, but they SHALL NOT claim rollback availability and SHALL
NOT accept rollback to a version that is not durably retained.

#### Scenario: Tenant owner rolls back a function to a retained prior version

- **WHEN** a function has at least two retained versions and a tenant owner requests rollback to a
  selected prior version in the same tenant and workspace
- **THEN** the active function action changes to that selected prior version, subsequent function
  detail shows the selected version as active, and the versions list still shows the retained
  history rather than losing the other versions.

#### Scenario: Function detail rollback availability matches the console Versions tab

- **WHEN** function detail says rollback is available
- **THEN** the web console Versions tab lists at least one prior retained version with
  `rollbackEligible: true`, selects an eligible prior version, and enables the Rollback button.

#### Scenario: Legacy active rows without retained history are not rollback eligible

- **WHEN** a function action row has a numeric version greater than one but has no retained version
  history
- **THEN** function detail reports rollback unavailable, the versions list returns only an active
  display row for the current function state, and rollback to that display row is rejected because it
  is not a retained prior version.
