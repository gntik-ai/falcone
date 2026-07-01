# web-console Specification (delta)

## ADDED Requirements

### Requirement: Console status-view calls stay routed

The system SHALL keep console status-views calls and control-plane routes in
sync, so a normal page load produces no 404 for an endpoint the SPA depends on.

#### Scenario: Pending activation page loads status view cleanly

- **WHEN** an unauthenticated user opens `/signup/pending-activation`
- **THEN** the page renders without firing a 404 request for
  `status-views/pending_activation`.
