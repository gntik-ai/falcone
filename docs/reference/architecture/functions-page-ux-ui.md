# Functions Page UX/UI Contract

`/console/functions` is the full function operations page for tenant owners and operators. It owns
the deploy, invoke, activation/log/result inspection, version history, and rollback loop. Keep this
page aligned with the console design system; the narrower quick-deploy page remains documented in
`docs/reference/architecture/functions-data-console-contract.md`.

## Authoring Surfaces

Function authoring controls use shared UI primitives:

- text and numeric fields use `Input`;
- runtime and response mode use `Select`;
- inline code and JSON payload editors use `Textarea`;
- JSON payload parsing uses `parseJsonObject` from `apps/web-console/src/lib/editor-ux.ts`;
- JSON defaults and displayed object payloads use `prettyJson` from the same helper.

Code and JSON editors are always monospace, spellcheck-off, autocorrect-off, and sized as editing
surfaces rather than prose fields. Machine identifiers such as resource IDs, version IDs,
activation IDs, and invocation IDs render in monospace text.

## Operations Feedback

All function operation outcomes render through `Alert`, including deploy, invoke, rollback,
partial activation-data failures, missing logs/results, and truncated-log warnings. Logs and result
payloads render through one shared console block style: bordered, muted, scrollable, monospace, and
safe for long lines.

Do not add new one-off `<pre>` blocks or hand-rolled `role="alert"` wrappers to the page. Add or
extend the shared page-local console block when a new function payload/log surface is needed.

## Status Tones

Action, version, invocation, and activation statuses use severity-encoded badge tone classes:

| Status family | Examples | Tone |
| --- | --- | --- |
| Success / available | `active`, `succeeded`, `success`, `completed`, `available` | emerald |
| Failure / invalid | `failed`, `failure`, `error`, `invalid`, `degraded`, `timed_out`, `cancelled` | red |
| Pending / in progress | `accepted`, `queued`, `running`, `provisioning`, `deploying` | sky |
| Inactive / historical | `suspended`, `historical`, `inactive` | amber |

These classes intentionally mirror the explicit tone pattern used by
`ConsoleAuditResultBadge.tsx` rather than relying only on the base badge variants.

## Detail Tabs

The function detail tabs are a real tab interface:

- the tab container has `role="tablist"` and an accessible label;
- each tab has `role="tab"`, `aria-selected`, `aria-controls`, and roving `tabIndex`;
- ArrowRight and ArrowLeft move between adjacent tabs;
- Home and End move to the first and last tabs;
- the active panel has `role="tabpanel"` and is labelled by the active tab.

Follow the `ConsoleMcpServerDetailPage` idiom for any future tabs added to this page.

## Deploy And Invoke Loop

The clear primary deploy action is the inline deploy path on `/console/functions`. This page must
not show a persistent capability-gate badge for a closed secondary wizard, and it must not promote a
registry-plane publish wizard as the primary action for the action-plane inventory.

After an invocation succeeds, the page refetches activations, resolves the activation by
`activationId`, matching `invocationId`, or the newest refreshed activation, selects it, switches to
the Activations tab, and renders the activation logs/result. This closes the visible loop for both
`accepted` and `wait_for_result` response modes without changing the backend API contract.

## Wire Impact

This UX/UI contract is frontend-only. It does not change function API routes, request/response
schemas, status codes, auth claims, OpenAPI/AsyncAPI, generated SDKs, shared wire types,
persistence, or real-time event shapes. `npm run generate:public-api` should remain a no-op for
this change.
