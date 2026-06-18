# storage — spec delta for fix-storage-object-binary-put

## ADDED Requirements

### Requirement: Object PUT is JSON-only (not S3-compatible, no binary)

The system SHALL ensure that object PUT is JSON-only (not S3-compatible, no binary) is corrected: Accept raw bytes (or base64) so arbitrary objects can be stored.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** Binary round-trip is byte-identical
