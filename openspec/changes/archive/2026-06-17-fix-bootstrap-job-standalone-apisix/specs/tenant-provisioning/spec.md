# tenant-provisioning — spec delta for fix-bootstrap-job-standalone-apisix

## ADDED Requirements

### Requirement: Bootstrap Job completes successfully on a fresh kind install

The system SHALL ensure the Keycloak bootstrap Job reaches the `Complete` state on
a fresh install regardless of the APISIX deployment mode (standalone or admin-API).

When `APISIX_STAND_ALONE=true` the bootstrap Job MUST skip all APISIX admin-API
reconciliation steps and MUST NOT emit any HTTP calls to the APISIX admin API.

#### Scenario: Fresh kind install — bootstrap Job completes

- **WHEN** the Helm chart is installed on a fresh kind cluster with
  `apisix.standaloneMode=true` (or equivalent)
- **THEN** the bootstrap Job MUST reach status `Complete` and the platform realm,
  console client, gateway client, and superadmin user MUST be present in Keycloak

#### Scenario: Bootstrap skips APISIX admin-API in standalone mode

- **WHEN** `APISIX_STAND_ALONE=true` is set and the bootstrap Job runs
- **THEN** the Job log MUST NOT contain any failed HTTP calls to the APISIX admin API
  (`127.0.0.1:9180` or equivalent) and the Job MUST exit 0

#### Scenario: Superadmin can log in after a fresh install

- **WHEN** the bootstrap Job has completed on a fresh install
- **THEN** a superadmin login attempt (`POST /v1/auth/login-sessions`) MUST return 201
  with a `tokenSet` containing valid `realm_access.roles`
