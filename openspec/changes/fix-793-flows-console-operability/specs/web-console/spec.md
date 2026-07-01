# web-console - spec delta for fix-793-flows-console-operability

## ADDED Requirements

### Requirement: Flows console is operable and consistent

The system SHALL provide a visible, accessible UI affordance to trigger a published flow's execution
from the console and reach that flow's run path. The Flows console SHALL be discoverable from the
console sidebar, SHALL preserve navigation from flow list to flow runs to run detail, and SHALL
render affected flow screens using shared console page states and status tokens instead of opaque
disabled overlays or plain ad hoc status text.

#### Scenario: Tenant owner triggers a published flow and reaches its run path

- **WHEN** a `tenant_owner` has a published flow
- **THEN** a Run/Trigger control starts an execution request through the existing
  `triggerFlowSchedule(workspaceId, flowId)` API, then takes the user to `/console/flows/{flowId}/runs`
  or otherwise surfaces a success/next-step state from which the user can open the run detail row at
  `/console/flows/{flowId}/runs/{executionId}` when the run appears.

#### Scenario: Flow screens use page states when unavailable, empty, or failing

- **WHEN** the workflows/flows console surface is unavailable, empty, or errors while loading data
- **THEN** the UI renders an appropriate `ConsolePageState` blocked, empty, or error state with an
  actionable CTA when practical, and does not hide the page behind an opaque dim/disabled overlay.
