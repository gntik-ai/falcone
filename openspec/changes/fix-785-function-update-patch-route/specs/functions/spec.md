# functions — spec delta for fix-785-function-update-patch-route

## ADDED Requirements

### Requirement: Console function-update requests are routed to the update handler (PATCH contract)

The system SHALL route a console function-update request (`PATCH /v1/functions/actions/{id}`) to the
function update/redeploy handler, matching the published `updateFunctions` (PATCH) contract
(`services/internal-contracts/src/public-route-catalog.json`,
`apps/control-plane/openapi/control-plane.openapi.json`), rather than returning
`404 {code:'NO_ROUTE'}`.

Because the kind control-plane route matcher is exact-method, the by-id function-update route SHALL be
registered with the same HTTP method the contract and the web console use for `updateFunctions`
(`PATCH`). Registering only a different method (e.g. `PUT`) for this path is a defect: the console's
`PATCH` request finds no route and the surface is permanently broken for every tenant.

#### Scenario: Editing an existing function via the console dispatches to the update handler

- **WHEN** a tenant owner edits an existing function and the console submits
  `PATCH /v1/functions/actions/{id}` (the `updateFunctions` operation) with a valid identity and an
  `Idempotency-Key`
- **THEN** the kind control-plane resolves the request to the function update/redeploy handler
  (`fnDeploy`) and a new function version is created, and the response is **not**
  `404 {code:'NO_ROUTE', message:'No action mapped for PATCH …'}`.

#### Scenario: The registered update method matches the published updateFunctions contract

- **WHEN** the by-id function-update route is inspected against the published route catalog
- **THEN** the kind control-plane registers exactly one update entry for
  `/v1/functions/actions/{id}` whose method equals the `updateFunctions` method declared in
  `public-route-catalog.json` (`PATCH`), and no stale `PUT` registration remains for that path.
