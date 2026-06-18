# document-store — spec delta for fix-mongo-indexes-missing-collection

## ADDED Requirements

### Requirement: Mongo collection-indexes on a missing collection -> 500

The system SHALL ensure that mongo collection-indexes on a missing collection -> 500 is corrected: Return 404 for a missing collection.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** 404 not 500
