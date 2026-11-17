# Flow run view migration review

Page: `console-flow-run-page`, issue #1286, risk R3. Blueprint SHA256:
`d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d`. Delivery base:
`e3791fc19f06ffadc7d9905a66af5f39311604eb`. Kit pins unchanged (ui, blocks, templates 0.12.0; tokens 0.4.0).

## Requests

| Action | Method and path | Payload | Legacy source | New source |
| --- | --- | --- | --- | --- |
| Load flow | `GET /v1/flows/workspaces/{ws}/flows/{flowId}` | none | `services/flowsApi.ts` `getFlow` | `consoleFlowRun/api.ts` `getFlow` |
| Load execution | `GET .../flows/{flowId}/executions/{executionId}` | none | `services/flowsMonitoringApi.ts` `getExecution` | `consoleFlowRun/api.ts` `getExecution` |
| Live stream | `GET /v1/flows/workspaces/{ws}/executions/{executionId}/events` | none; `Authorization: Bearer`, `Last-Event-ID` on resume | `subscribeFlowExecution` (EventSource, `?apikey=`) | `streamFlowExecutionEvents` (#1081), unchanged |
| Cancel | `POST .../executions/{executionId}/cancellations` | none | `cancelExecution` | `cancelExecution` |
| Retry | `POST .../executions/{executionId}/retries` | none | `retryExecution` | `retryExecution` |
| Approve, reject | `POST .../executions/{executionId}/signals/{nodeId}` | `{ approved, nodeId }` | `sendApprovalSignal` | `sendApprovalSignal` |

Shell bootstrap and the session refresh are the only other requests. No request URL carries a query string or a
credential; the anonymous-key input, state and `?apikey=` URL are gone.

## Behaviour carried from the legacy page

- The run opens a stream only for a non-terminal run with a loaded detail; a live frame wins per node over the persisted
  status; `stream-end` reloads the detail once and closes the stream; unmounting closes it.
- Cancelar is always visible and disabled on a terminal run; Reintentar is hidden on a non-terminal run; Aprobar and
  Rechazar render only while a node is waiting for approval. Cancelar and Rechazar use destructive alert-dialogs.
- The display cap (4096 characters plus an ellipsis and a badge, a dash for null, strings unquoted) is ported from
  `RunNodeDetailPanel.tsx`; the full payload stays in memory.
- Missing ids and no workspace show `Ejecución bloqueada`; no definition replaces the canvas and hides the toolbar.

## Legacy changes since the blueprint

The two legacy commits after the blueprint (`61ce55252829` localized validation diagnostics, `0b685425b975` console
API extraction) change import paths, the designer node shell's validation tooltip and the `params` field of
`ValidationError`. The run canvas never carries validation errors, so only the `params` field is mirrored in
`consoleFlowRun/flows.ts`; no behaviour, request, validation, state or copy of the run page changed.

## Deliberate differences

See `deliberateChanges` in the manifest. The stream client exposes no drop signal, so `consoleFlowRun/stream.ts` observes
the events fetch (without altering request or response) to turn the live indicator off and show the inline notice.

## Verification status

Chromium is unavailable in the maker sandbox: browser parity, axe, viewport and CSP asset runs are SKIPPED here and run in
PR CI. The visual-review journey captures the completed, running, waiting-approval, failed, truncated-payload,
no-definition, no-access and error states in es and en at 375, 768 and 1280 px with a frozen clock; screenshot assessment
and baseline approval happen in the PR CI journey and at operator approval. `validate_page` is NOT_RUN because no
gntik_ui MCP server is available; the Hermes snapshot and the colour lint stand in.
