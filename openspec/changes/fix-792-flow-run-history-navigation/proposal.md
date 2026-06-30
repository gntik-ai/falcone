## Why

The console already registers the flow run-monitoring routes:

- `/console/flows/{flowId}/runs`
- `/console/flows/{flowId}/runs/{executionId}`

However, those routes were orphaned from the normal Flows experience. The flow list exposed only an
`Open designer` action, and the designer header linked only back to `Flows`. A user could reach a
run detail from the run-history page, but could not discover the run-history page from the flow list
or designer without manually knowing the URL.

This is a frontend-only navigation bug. The backend execution APIs, route paths, response shapes,
OpenAPI artifacts, generated SDK/types, and realtime event contracts do not change.

## What Changes

- Add a visible `Run history` affordance to each row on `ConsoleFlowsPage`, linking to
  `/console/flows/{flowId}/runs`.
- Add a visible `Run history` affordance to `ConsoleFlowDesignerPage`, linking to
  `/console/flows/{flowId}/runs`.
- Extend web-console tests so the issue scenario is encoded:
  - the flow list renders a row-level run-history link;
  - the flow designer renders a run-history link;
  - the existing run-history row link to `/console/flows/{flowId}/runs/{executionId}` remains
    covered.
- Add a concise architecture reference note for the console flow navigation chain.

## Capabilities

### Added Capabilities

- `web-console`: require the console to provide a visible navigation path from flow authoring/list
  surfaces into that flow's run history, and from run history rows into run detail pages.
