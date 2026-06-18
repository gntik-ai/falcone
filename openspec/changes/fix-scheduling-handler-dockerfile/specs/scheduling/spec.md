# scheduling — spec delta for fix-scheduling-handler-dockerfile

## ADDED Requirements

### Requirement: Scheduling handler missing from the control-plane image

The system SHALL ensure that scheduling handler missing from the control-plane image: Add the COPY for the scheduling handler (and a startup check that every route-map handler resolves).

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** `/v1/scheduling/*` returns business responses
