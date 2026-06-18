# workflows — spec delta for add-event-trigger-integration

## ADDED Requirements

### Requirement: Event-driven integration (Kafka -> function / workflow) not working E2E

The system SHALL ensure that event-driven integration (Kafka -> function / workflow) not working E2E is corrected: Deploy/wire the event-trigger consumer so a published event invokes the bound function/flow; ensure the Temporal custom search attributes are registered by the deploy.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** Publishing an event triggers the bound flow/function and the effect is observable
