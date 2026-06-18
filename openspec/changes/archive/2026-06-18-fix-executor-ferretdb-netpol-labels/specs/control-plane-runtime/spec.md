# control-plane-runtime — spec delta for fix-executor-ferretdb-netpol-labels

## ADDED Requirements

### Requirement: cp-executor cannot reach FerretDB (NetworkPolicy label mismatch)

The system SHALL ensure that cp-executor cannot reach FerretDB (NetworkPolicy label mismatch) is corrected: Set `app.kubernetes.io/name: control-plane-executor` on the executor pod template; align the chart `controlPlaneExecutor` labels with the NetworkPolicy contract.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** Executor mongo CRUD 2xx on a clean deploy
