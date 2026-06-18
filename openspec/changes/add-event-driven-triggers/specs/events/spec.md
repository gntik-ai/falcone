# events — spec delta for add-event-driven-triggers

## ADDED Requirements

### Requirement: Event-driven triggers end-to-end (Kafka -> function / flow)

The system SHALL ensure that event-driven triggers end-to-end (Kafka -> function / flow): Deploy/wire the event-trigger consumer so a published event invokes the bound function/flow.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** Publishing an event invokes a function and/or starts a workflow end-to-end
