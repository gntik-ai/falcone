# data-api — spec delta for fix-data-api-contract-mismatches

## ADDED Requirements

### Requirement: Data-API field/path mismatches (mongo provision, fn inlineCode, bulk path, apikey casing)

The system SHALL ensure that data-API field/path mismatches (mongo provision, fn inlineCode, bulk path, apikey casing): Align the handlers with the OpenAPI-documented shapes (or correct the catalog/docs) + contract tests.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** The documented shapes work
