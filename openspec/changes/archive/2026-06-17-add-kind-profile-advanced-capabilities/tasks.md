# Tasks — add-kind-profile-advanced-capabilities

## Implementation
- [x] Author `deploy/kind/values-kind-advanced.yaml` opt-in overlay (layered on
  `values-kind.yaml`) that enables Temporal + the workflow-worker, the MCP hosting component, and
  the realtime-capable executor, wiring `TEMPORAL_ADDRESS` / `TEMPORAL_NAMESPACE` /
  `TEMPORAL_TASK_QUEUE` + `MCP_ENABLED` on the executor (Flows routes register only with
  `TEMPORAL_ADDRESS`; realtime is inherent to the executor).
- [x] Document the install recipe in the overlay header.

## Verification (LIVE — test-cluster-b, 2026-06-17)
- [x] Built + pushed `in-falcone-workflow-worker:adv-20260617`; deployed a Temporal dev server +
  the workflow-worker (READY, polling `flows-main` on namespace `falcone-flows`); set
  `TEMPORAL_ADDRESS` + `MCP_ENABLED` on the live executor.
- [x] **Flows**: `GET /v1/flows/workspaces/{ws}/task-types` → **200** (real activity catalog);
  `GET /v1/flows/workspaces/{ws}/flows` → **200** `{items:[]}` (was 404 before — registered on
  `TEMPORAL_ADDRESS`).
- [x] **MCP**: `GET /v1/mcp/workspaces/{ws}/servers` → **200** (registered on `MCP_ENABLED`).
- [x] **Realtime SSE**: subscribe → `200 text/event-stream` (`retry: 3000`); insert a row → the
  stream delivered `event: insert` with the tenant-scoped document. (Also solved the campaign's
  open DDL puzzle: a PK column needs `nullable:false` + `constraints:{primaryKey:true}`.)
- [x] Black-box render test `tests/blackbox/kind-advanced-profile.test.mjs` (bbx-adv-01/02/03)
  asserts the overlay enables + wires the components.
- [x] `bash tests/blackbox/run.sh`; `openspec validate add-kind-profile-advanced-capabilities --strict`.

## Archive
- [x] `/opsx:archive add-kind-profile-advanced-capabilities`
