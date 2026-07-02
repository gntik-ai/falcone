## Why

Issue #789 identifies a frontend UX/UI gap on `/console/functions`. The page already supports the
full function operations loop, but the authoring, invocation, activation, and version surfaces used
raw controls and inconsistent status/outcome treatments that did not match the console's
design-system standard.

Tenant owners and DevOps operators need a coherent authoring and operations screen: code and JSON
should read like code, status should communicate severity, tabs should be accessible, and invoking a
function should lead directly to the activation/result evidence.

## What Changes

- Render function code and invocation JSON editors with shared console form primitives, monospace
  typography, spellcheck disabled, and JSON parsing/pretty-printing from `lib/editor-ux.ts`.
- Replace hand-rolled outcome panels with `Alert` and render logs/results through a shared
  monospace console block.
- Color-encode action, version, invocation, and activation status using local tone classes
  consistent with `ConsoleAuditResultBadge`.
- Replace the wrapping detail button row with a keyboard-accessible tablist using the
  `ConsoleMcpServerDetailPage` roving-focus idiom.
- Make the inline deploy flow the page's coherent primary deploy action and remove the closed
  wizard capability gate that leaked a persistent badge into the detail surface.
- After invoke, refetch activations, select the activation linked to the invocation, switch to the
  Activations tab, and render logs/result there, including `wait_for_result` flows.
- Add focused Vitest coverage for the issue scenario.
- Add architecture docs under `docs/reference/architecture/functions-page-ux-ui.md`.

## Wire / Contract Impact

This is a frontend-only UX and accessibility change. It does not change backend routes, request or
response schemas, status codes, error schema, pagination/filter params, auth/claim semantics,
OpenAPI/AsyncAPI, generated clients, shared wire types, persistence, or real-time event shapes.
Public API generation should remain a no-op.
