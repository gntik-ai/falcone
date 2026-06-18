# workflows — spec delta for fix-flows-worker-pg-env-and-search-attrs

## ADDED Requirements

### Requirement: Flows worker DB wiring + Temporal search-attribute bootstrap

The system SHALL ensure that flows worker DB wiring + Temporal search-attribute bootstrap: Inject the PG env into the worker; run a search-attribute bootstrap step on deploy.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** A flow's `db.query` activity returns rows
