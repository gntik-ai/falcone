# Frozen legacy reference values

Captured by executing the legacy public clients, route configuration and snippet generator
at source base `69296937330b61be2bbf2c7267520196499fc038`, before removing the retired app.
These literals are independent of the next implementation and must not be regenerated from it.

| Fixture | Legacy source relative to the retired app root | Inputs |
| --- | --- | --- |
| routes.json | src/router.tsx | Public appRoutes, with auth config paths resolved |
| realtime-snippets.json | src/lib/snippets/snippet-catalog.ts | realtime-subscription catalogue |
| postgres-snippets.json | src/lib/snippets/snippet-generator.ts | app_db, public schema, port 5432, missing host |
| storage-snippets.json | src/lib/snippets/snippet-generator.ts | media-assets, eu-west-1, missing endpoint |
| tenant-plan-requests.json | src/services/planManagementApi.ts | ten_alpha, active plans, plan-team assignment |
| own-plan-request.json | src/services/planManagementApi.ts | Own tenant, includeConsumption, fixed request UUID |
| flow-requests.json | src/services/flowsApi.ts | ws/1, f/1, Trimmed draft |
| flow-history.json | src/services/flowsMonitoringApi.ts | Six filter combinations, with and without opaque cursor |

Only synthetic sessions and placeholder credentials were used. Request headers in these fixtures
contain synthetic test values, never operator credentials.

`service-account-journeys.json` records the five request/refetch and disclosure contracts
from `src/pages/ConsoleServiceAccountsPage.tsx` at the same base (callbacks at lines 257–345),
with the existing parity manifest response literals. This fixture was transcribed from those
callbacks; Chromium was unavailable for browser capture. The parity suite still executes all
five next-console journeys against these independent literals in each locale/viewport cell.
