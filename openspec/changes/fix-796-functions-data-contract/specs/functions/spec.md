# functions — spec delta for fix-796-functions-data-contract

## ADDED Requirements

### Requirement: Data: Functions console drives the functions API per contract

The system SHALL make the Data: Functions console drive the published functions API contract for
workspace function listing, function deployment, function invocation, and activation listing.

The console SHALL use the workspace-scoped list route only for listing, SHALL use the action
collection route for deployment, and SHALL use action `resourceId` routes for operations on an
existing function action. The console SHALL render and select listed actions from contract fields
(`actionName`, `execution.runtime`, and `resourceId`) rather than legacy `name`/`runtime` fields.

#### Scenario: Deploying a valid function spec from the data console uses the action collection route

- **WHEN** a tenant owner deploys a valid function spec on `/console/functions/data`
- **THEN** the console sends the request to `POST /v1/functions/actions` with a
  contract-compatible function action write body that includes the active `tenantId`, active
  `workspaceId`, action name, source, execution configuration, and activation policy, and the
  request does **not** hit `404 {code:'NO_ROUTE'}` by posting to the GET-only workspace actions
  route.

#### Scenario: Listed functions display contract fields and selection uses resourceId routes

- **WHEN** `/console/functions/data` lists workspace functions from
  `GET /v1/functions/workspaces/{workspaceId}/actions`
- **THEN** each row displays the returned `actionName` and `execution.runtime`, and selecting a row
  drives Invoke and Activations calls against the real `resourceId` via
  `POST /v1/functions/actions/{resourceId}/invocations` and
  `GET /v1/functions/actions/{resourceId}/activations`, never against `undefined` or a legacy
  `name` field.
