# Flow console navigation

The web console keeps flow authoring and flow monitoring on separate routes, but the routes must be
reachable from the normal flow-management path:

| Surface | Route | Required navigation |
| --- | --- | --- |
| Flow list | `/console/flows` | Each flow row exposes `Run history`, linking to `/console/flows/{flowId}/runs`. |
| Flow designer | `/console/flows/{flowId}` | The designer header exposes `Run history`, linking to `/console/flows/{flowId}/runs`. |
| Run history | `/console/flows/{flowId}/runs` | Each run row exposes `Open`, linking to `/console/flows/{flowId}/runs/{executionId}`. |
| Run detail | `/console/flows/{flowId}/runs/{executionId}` | The breadcrumb links back to the flow's run history. |

This navigation is a console concern only. It does not change the flow execution API, OpenAPI
artifacts, generated SDK/types, or realtime event schemas.
