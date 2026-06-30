# Console create-form validation

Console create forms must validate required fields in the browser before constructing create API
payloads. This page documents the frontend invariants for the create flows that collect numeric
limits or plan display names.

## Required numeric limit fields

Guided console wizards validate required numeric limit fields on the step where the operator edits
them. A limit field is valid only when its trimmed value is a base-10 integer string within the
field's configured range.

The shared parser in `apps/web-console/src/lib/console-create-form-validation.ts` rejects:

- an empty or whitespace-only value
- non-integer text such as `abc`, `1.5`, or `1e3`
- negative values
- zero when the field's minimum is positive
- integers outside the configured range
- integers outside JavaScript's safe integer range

Wizards must render the parser error next to the field and must disable `Siguiente` while any
field on the current step is invalid. Submit handlers must also re-parse the stored string values
before constructing the request body. The re-parse is a defense-in-depth guard: even if a future UI
change bypasses step validation, the console must not send `null`, `NaN`, zero, out-of-range, or
negative limit values.

## Workspace creation

`CreateWorkspaceWizard` validates these configuration-step fields:

- `workspace-max-functions`: required integer from `1` through `Number.MAX_SAFE_INTEGER`
- `workspace-max-databases`: required integer from `1` through `Number.MAX_SAFE_INTEGER`

The workspace endpoint currently receives these values under the existing
`initialLimits.maxFunctions` and `initialLimits.maxDatabases` payload shape. This fix does not add
or change a backend contract; it prevents invalid values from being constructed on the console
side.

## Function publishing

`PublishFunctionWizard` validates these runtime-step fields:

- `fn-memory`: required integer from `128` through `2048` MB, matching the governed OpenWhisk
  memory envelope already present in the function contract
- `fn-timeout`: required integer from `1` through `900000` ms, matching the 900-second governed
  action timeout ceiling in millisecond form

The wizard sends the existing `limits.memoryMb` and `limits.timeoutMs` payload shape. The console
must never use `Number(...)` directly on unvalidated field strings because `Number('abc')` produces
`NaN`, and `JSON.stringify` serializes `NaN` as `null`.

## Plan creation

`ConsolePlanCreatePage` validates the required `display-name` field before calling
`createPlan`. The value is trimmed for validation; an empty or whitespace-only display name renders
an inline display-name error and returns without calling the API helper.

Slug validation remains separate. If slug validation fails, the page still returns before
`createPlan`.

## Contract impact

This validation is frontend-only. It does not change:

- OpenAPI or AsyncAPI artifacts
- generated clients or shared types
- endpoint paths, request/response shapes, status codes, pagination/filter parameters, auth
  claims, or real-time event shapes

When a future create flow adds a new required numeric limit, use the shared required-integer parser
and add a focused component test that proves invalid values are shown inline, block the next/submit
action, and do not call the create API.
