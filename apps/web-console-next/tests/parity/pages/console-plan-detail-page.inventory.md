# Plan detail migration evidence

- Page: `console-plan-detail-page`, `/console/plans/:planId`, wave u2, issue #1261, risk R3.
- Blueprint: `57f536f4-a597-4564-9c85-bc835b96e41f`, SHA256 `d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d`.
- Approved canonical page entry SHA256: `62fd836d9a05d5d66768330b22a174dd9fed27d130862493d82314fcaaf21ed0`.
- Hermes kit snapshot SHA256: `5d8e62d71347c36a5b9a5b8022c5244ae3f3d8f59a20647d2cb9d764cdb95038`. UI, blocks and templates stay at `0.11.0` and tokens at `0.3.0`; no package or lockfile changed.

## Request parity

`src/pages/consolePlanDetail/api.ts` mirrors `apps/web-console/src/services/planManagementApi.ts`:

| Action | Method and path | Payload | Legacy | New |
| --- | --- | --- | --- | --- |
| Load plan | GET `/v1/plans/{id}` | none | `planManagementApi.ts:302` | `api.ts` `getPlan` |
| Load limits | GET `/v1/plans/{id}/limits` | none | `planManagementApi.ts:309` | `api.ts` `getLimits` |
| Lifecycle | POST `/v1/plans/{id}/lifecycle` | `{targetStatus}` | `planManagementApi.ts:305` | `api.ts` `transitionPlan` |
| Delete plan | DELETE `/v1/plans/{id}` | none | `planManagementApi.ts:304` | `api.ts` `deletePlan` |
| Save limit | PUT `/v1/plans/{id}/limits/{key}` | `{value}` | `planManagementApi.ts:310` | `api.ts` `setLimit` |
| Reset limit | DELETE `/v1/plans/{id}/limits/{key}` | none | `planManagementApi.ts:311` | `api.ts` `removeLimit` |

Ids and dimension keys are URL-encoded, which is identical for slugs, UUIDs and dimension keys. The
transport is the shared console-api session client (`requestConsoleSessionJson`). Lifecycle POST and
plan DELETE instead authenticate once and, on a 401, refresh the session and report it without sending
again (operator decision, non-idempotent writes).

## Legacy changes since the blueprint

The legacy diff from `fecb3a03` to `0f6ead10` moves the HTTP transport to console-api (carried over) and
adds a flag-gated lifecycle-history fetch and a "Historial de estados" section to the legacy detail page.
By operator decision (2026-11-04) the new page makes no history fetch and shows exactly one timeline
entry, the current status at `updatedAt`. The accepted parity changes are recorded in the OpenSpec proposal.

## Kit composition

Page, PageHeader (title, status tag, slug meta), Stepper, Tabs, DescriptionListCard, StatusTimeline,
StatusTag, DataTable with `paginated={false}`, NumberInput, InlineCallout, ErrorPanel, NoAccessEmpty,
NotFoundEmpty, EmptyState, TableSkeleton, AlertDialog and Toast. PageHeader actions are not used: the
lifecycle and delete buttons need `aria-describedby`, `aria-busy` and a disabled-not-hidden state that the
header action model cannot express. The confirm-destructive block hard-codes English type-to-confirm copy
(`gap-kit-builtin-copy-english`), so confirmations compose AlertDialog with catalog copy; the plan
`displayName` is the only untranslated token. Empty capabilities and limits use EmptyState because the
first-run block always renders an action button.

## Tests and review boundaries

Vitest covers requests per action, status gating, the typed gate, success feedback only after success,
the limit keyboard rules and validation, retry placement and identical re-send, the lost lifecycle response,
401 no-replay, 403 no-access, es and en copy, routing and rollback. The parity spec covers es and en at 375,
768 and 1280 pixels (data, action, error-empty, accessibility, kit-conformance, runtime-health, responsive and
visual-review) and a permission-denial matrix. Chromium is unavailable in the maker sandbox: the browser
runs are executed by PR CI, and screenshot artifacts still need the checker's assessment and operator
approval. The offline kit MCP server is unavailable, so validate_page is NOT_RUN.
