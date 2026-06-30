## Why

Console create flows accepted invalid required values before reaching the backend. Two guided
wizards (`CreateWorkspaceWizard` and `PublishFunctionWizard`) converted string inputs with
`Number(...)` at submit time even when the current step had no validation for those fields.
Non-numeric values therefore became `NaN`, which JSON serializes as `null`; zero and negative
values could also be sent. The plan-create page validated only the slug, so a blank or
whitespace-only display name still called `createPlan`.

These are frontend defects: the console should prevent invalid create payloads inline, before
the request is constructed. No backend endpoint, OpenAPI schema, generated client, or shared
contract changes are required.

## What Changes

- Add a strict console create-form integer parser for required limit fields. It rejects blank
  strings, non-integer text, negative values, zero when the minimum is positive, unsafe integers,
  and values above the configured field maximum.
- `CreateWorkspaceWizard` validates `workspace-max-functions` and
  `workspace-max-databases` on the configuration step, renders inline field errors, disables
  `Siguiente` while either field is invalid, and re-parses the values at submit time before
  constructing `initialLimits`.
- `PublishFunctionWizard` validates `fn-memory` and `fn-timeout` on the runtime step, renders
  inline field errors, disables `Siguiente` while either field is invalid, and re-parses the
  values at submit time before constructing `limits`.
- `ConsolePlanCreatePage` validates that display name is non-empty after trimming whitespace,
  renders an inline field error, and returns before calling `createPlan`.
- Add focused Vitest/Testing Library coverage for the WHEN/THEN scenarios in issue #807.
- Add architecture documentation under `docs/reference/architecture/` for console create-form
  validation rules and bounds.

## Contract / Wire Impact

No API contract, generated SDK/client, shared types, endpoint shape, status code, or real-time
event shape changes. This is a frontend validation fix that preserves the existing wire payload
shape while preventing invalid payload values from being sent.

## Capabilities

### Modified Capabilities

- `web-console`: an ADDED requirement covering inline validation for console create forms that
  collect required numeric limits or required display names.
