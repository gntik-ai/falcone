# web-console Specification (delta)

## ADDED Requirements

### Requirement: Operations polling fails safe on persistent query errors

The system SHALL bound and back off retries for the web console operations resource when
`/v1/async-operation-query` fails persistently. The operations page SHALL stop automatic retries
after a small retry budget, surface a clear error state, and keep the manual retry control available.
It SHALL NOT issue an unbounded burst of identical failing requests due to render-loop or effect
dependency churn.

#### Scenario: Backend returns 500 for the operations query

- **WHEN** `/console/operations` loads and `POST /v1/async-operation-query` returns a persistent
  error
- **THEN** the console makes only a bounded number of requests with backoff, then shows the
  operations error state with a manual retry action, and no continuous request burst occurs
