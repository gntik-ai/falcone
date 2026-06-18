# functions — spec delta for fix-functions-invoke-input-binding

## ADDED Requirements

### Requirement: Function invoke drops top-level input

The system SHALL ensure that function invoke drops top-level input is corrected: Accept top-level input (or document the envelope and validate).

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** The documented shape returns the correct result
