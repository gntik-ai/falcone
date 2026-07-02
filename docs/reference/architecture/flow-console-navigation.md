# Flow console navigation

The web console keeps flow authoring and flow monitoring on separate routes, but the routes must be
reachable from the normal flow-management path:

| Surface | Route | Required navigation |
| --- | --- | --- |
| Sidebar | `/console/flows` | The shell navigation exposes `Flujos / workflows`, using the workspace workflow icon and activating for the flow child routes. |
| Flow list | `/console/flows` | Each flow row exposes `Run now` for published flows and `Run history`, linking to `/console/flows/{flowId}/runs`. Draft or non-published rows keep editing controls available but disable `Run now` with an accessible reason. |
| Flow designer | `/console/flows/{flowId}` | The designer header exposes `Run now` for published flows and `Run history`, linking to `/console/flows/{flowId}/runs`. |
| Run history | `/console/flows/{flowId}/runs` | Each run row exposes `Open`, linking to `/console/flows/{flowId}/runs/{executionId}`. |
| Run detail | `/console/flows/{flowId}/runs/{executionId}` | The breadcrumb links back to the flow's run history. |

`Run now` calls the existing schedule trigger endpoint through `triggerFlowSchedule(workspaceId,
flowId)`. The endpoint acknowledges `{ "status": "triggered", "scheduleId": "..." }` but does not
return an execution id, so the console navigates to the flow's run history with a success/next-step
message. The user refreshes the history and opens the new run detail row when the execution appears.

The flow console uses shared console page states for blocked, loading, empty, and error conditions:
missing workspace context is a blocked state with a workspace CTA, empty lists explain the next
authoring/run step, and load failures expose retry actions. These states intentionally replace any
opaque disabled overlay for the flows surface.

This navigation and operability work is a console concern only. It uses the existing flow execution
API, OpenAPI artifacts, generated SDK/types, and realtime event schemas without changing their wire
shape.
