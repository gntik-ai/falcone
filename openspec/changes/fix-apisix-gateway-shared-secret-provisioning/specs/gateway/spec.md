# gateway — spec delta for fix-apisix-gateway-shared-secret-provisioning

## ADDED Requirements

### Requirement: GATEWAY_SHARED_SECRET is provisioned and consistent across components

The system SHALL ensure that the `GATEWAY_SHARED_SECRET` environment variable is
available to the APISIX gateway process and to the executor on every installation,
sourced from a chart-managed Kubernetes Secret.

The secret value MUST be generated (or accepted as an override) at install time and
MUST NOT be left unset, causing a startup crash.

#### Scenario: APISIX starts without CrashLoopBackOff

- **WHEN** the Helm chart is installed without a pre-existing `GATEWAY_SHARED_SECRET`
- **THEN** the chart MUST generate and provision the secret automatically; APISIX MUST
  reach the `Running` state without a crash

#### Scenario: Executor enforces gateway trust using the shared secret

- **WHEN** the executor receives a request that must pass the gateway-trust check
- **THEN** the executor MUST validate the request against `GATEWAY_SHARED_SECRET`
  and reject requests that do not carry a valid gateway signature
