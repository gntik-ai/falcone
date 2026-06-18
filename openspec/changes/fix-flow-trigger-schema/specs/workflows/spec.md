# workflows — spec delta for fix-flow-trigger-schema

## ADDED Requirements

### Requirement: Flow/webhook trigger schema missing (event->flow + webhook publish 502)

The system SHALL ensure that flow/webhook trigger schema missing (event->flow + webhook publish 502): Add the trigger tables to the governance migration set.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** Event/webhook trigger registration succeeds
