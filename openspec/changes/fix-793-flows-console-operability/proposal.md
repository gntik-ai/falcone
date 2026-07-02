## Why

The Flows console exposed authoring and run-history screens, and the schedule trigger API was already
routed, but users could not start a published flow from the console. `/console/flows` was also absent
from the shell navigation, and flow screens mixed ad hoc loading/empty/error UI with plain status
text, which made the feature feel unfinished and harder to operate end to end.

This is a frontend operability enhancement. The existing backend route
`POST /v1/flows/workspaces/{workspaceId}/flows/{flowId}/schedule/trigger` already returns
`{ "status": "triggered", "scheduleId": "..." }`, so no backend route, request/response shape,
OpenAPI, generated SDK/client, or realtime event contract changes are required.

## What Changes

- Add a `Flujos / workflows` sidebar item that links to `/console/flows`.
- Add `Run now` controls to published flow rows and the designer header.
- Gate `Run now` for draft/non-published flows with an accessible disabled reason while preserving
  draft editing and run-history navigation.
- Confirm before calling `triggerFlowSchedule(workspaceId, flowId)`.
- Navigate to `/console/flows/{flowId}/runs` after a successful trigger and show a next-step success
  state because the trigger API does not return an execution id.
- Use shared `ConsolePageState` blocked/loading/empty/error states on affected flow screens where
  practical.
- Render flow/run status with shared tokenized badges instead of plain status text.
- Extend focused web-console tests for the trigger scenario, draft disablement, sidebar navigation,
  and page states.
- Update flow-console documentation.

## Capabilities

### Added Capabilities

- `web-console`: the Flows console is operable end to end from sidebar discovery through published
  flow triggering, run-history navigation, and run-detail reachability, using shared console page
  states and status tokens.
