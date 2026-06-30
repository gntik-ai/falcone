## Why

The `/console/functions/data` page drifted from the published functions API contract. It posted
deploy requests to the workspace list URL (`POST /v1/functions/workspaces/{workspaceId}/actions`),
but that route is GET-only in the OpenAPI document and the kind control-plane route table. The
runtime therefore returned `404 {code:'NO_ROUTE'}` for an otherwise valid deploy.

The same page also treated listed functions as legacy `{name, runtime}` rows. The contract list
response emits `FunctionAction` items keyed by `resourceId`, with the display name in `actionName`
and runtime under `execution.runtime`. Selecting the legacy fields made Invoke and Activations
construct URLs with an undefined or non-resource identifier instead of the real
`/v1/functions/actions/{resourceId}/...` routes.

This is frontend contract drift only. The backend route table and OpenAPI paths already expose the
correct list, deploy, invoke, and activation operations, so the minimal fix is to bring the web
console data client and page state into line with those existing contracts.

## What Changes

- `apps/web-console/src/services/functionsApi.ts`
  - Keep list as `GET /v1/functions/workspaces/{workspaceId}/actions`.
  - Change deploy to `POST /v1/functions/actions`.
  - Accept the page's legacy JSON-editor convenience shape (`name`, `runtime`, `code`, `main`) and
    map it to a function action write request with `tenantId`, `workspaceId`, `actionName`,
    `source`, `execution`, and `activationPolicy`.
  - Preserve already contract-shaped JSON while stamping the active `tenantId` and `workspaceId`.
  - Change get/invoke/activations helpers to address actions by `resourceId`.
  - Wrap plain invocation payloads in `{parameters: ...}` while preserving an existing invocation
    envelope.
- `apps/web-console/src/components/console/FunctionsConsole.tsx`
  - Render `actionName` and `execution.runtime`.
  - Store/select the contract `resourceId`.
  - Call Invoke and Activations with that `resourceId`, never `undefined`.
  - Accept either `actionName` or legacy `name` in deploy validation.
- Focused web-console tests now encode both issue scenarios:
  - service tests assert the contract routes and deploy/invocation body mapping;
  - component tests assert contract-shaped rows render correctly and drive resourceId-scoped calls.
- Documentation is added under `docs/reference/architecture/` to make the Data: Functions console
  route and payload mapping explicit for future frontend/backend work.

## Spec Placement

This checkout has no `openspec/specs/` base specifications to modify. Following the issue
instruction, this change therefore adds a delta under `specs/functions/spec.md` with
`## ADDED Requirements` rather than declaring a `MODIFIED` requirement that has no base
requirement to attach to.

## Non-Goals

- No backend route, handler, OpenAPI, or generated public API artifact changes. The published
  contract already defines the correct paths for this issue.
- No Kubernetes mutation or live deployment verification in this worktree run, per the user's
  explicit instruction.
