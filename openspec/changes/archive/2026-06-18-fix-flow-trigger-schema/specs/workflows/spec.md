# workflows — spec delta for fix-flow-trigger-schema

## ADDED Requirements

### Requirement: Flow trigger tables exist before any trigger registration

The flow trigger store schema SHALL be created at boot whenever flows are enabled — both
`flow_trigger_registrations` and `flow_trigger_secrets` — so registering a platform-event
or webhook trigger never fails with a missing-relation error.

#### Scenario: publishing a flow with a trigger succeeds

- **WHEN** a flow with a platform-event or webhook trigger is published
- **THEN** the trigger registration is persisted (no 502
  `relation "flow_trigger_registrations" does not exist`) and the event→flow / webhook
  path is wired.
