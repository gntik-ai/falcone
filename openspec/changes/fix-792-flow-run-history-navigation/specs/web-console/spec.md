# web-console - spec delta for fix-792-flow-run-history-navigation

## ADDED Requirements

### Requirement: Flow run history is reachable from flow authoring surfaces

The system SHALL provide a visible, accessible navigation path from the flow list and/or the flow
designer to that flow's run history at `/console/flows/{flowId}/runs`. The run-history page SHALL
preserve a visible row-level affordance that opens a specific execution detail at
`/console/flows/{flowId}/runs/{executionId}`.

#### Scenario: User navigates from a flow surface to run history and then to run detail

- **WHEN** a user views a flow in the list or designer
- **THEN** a visible `Runs` or `Run history` affordance links to `/console/flows/{flowId}/runs`;
  from a run row the user can open `/console/flows/{flowId}/runs/{executionId}`.
