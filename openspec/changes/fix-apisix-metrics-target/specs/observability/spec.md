# observability — spec delta for fix-apisix-metrics-target

## ADDED Requirements

### Requirement: Prometheus APISIX scrape target is down

The system SHALL ensure that prometheus APISIX scrape target is down: Expose an APISIX metrics endpoint and point the scrape config at it.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** The APISIX scrape target is UP
