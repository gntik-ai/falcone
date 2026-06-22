# Flow schedule management API

A flow that declares a `cron` trigger gets a **Temporal Schedule** when a version is published
(`apps/control-plane/src/runtime/flow-trigger-registry.mjs`). The schedule fires the flow on its cron
cadence. The schedule-management API lets a tenant owner **operate that schedule in place** —
list/inspect it, pause and resume it, and request an ad-hoc run — **without deleting the flow
definition**. It complements the existing flow lifecycle, where the only schedule controls were
register-on-publish, swap-on-republish, and delete-on-flow-delete.

These routes are served by the **flow executor runtime**
(`apps/control-plane/src/runtime/server.mjs`), registered only when a flow executor is wired
(`TEMPORAL_ADDRESS` set). They are addressed under the same workspace-scoped flows prefix as the rest
of the Flows API. The kind control-plane (`deploy/kind/control-plane`) does **not** serve flows routes
— flows are executor-only — and the APISIX gateway wildcard-routes `/v1/flows/*` to the executor. The
five schedule paths are added to the gateway allow-list
(`services/gateway-config/public-route-catalog.json`, `structural_admin`) alongside the other flows
routes so the gateway admits them rather than rejecting them 404-before-route.

## Schedule identity and tenant isolation

There is exactly **one schedule per flow**, and its Temporal id is

```text
{tenantId}:{workspaceId}:{flowId}
```

(`scheduleIdFor`). This composite id IS the structural isolation boundary. Every per-flow operation
derives the id from the **verified** identity's `tenantId` and the **verified identity `workspaceId`**
(the `x-workspace-id` the gateway injects from the credential, falling back to the path workspace) —
after the request gate has already validated that the workspace belongs to the caller's tenant
(`CROSS_TENANT_VIOLATION` 403 otherwise), exactly as for the rest of the Flows API. The system never
trusts a tenant or workspace from the request body.

Because the id is built from the verified tenant and the validated workspace, a request that
references **another tenant's or workspace's flow** resolves to a schedule id that does not exist:
Temporal raises `ScheduleNotFoundError`, which the executor maps to **`404 SCHEDULE_NOT_FOUND`**. The
response does **not** reveal whether the foreign schedule exists, and the path never returns a `500`.
The list operation enforces the same boundary by returning **only** schedules whose id begins with
the caller's `{tenantId}:{workspaceId}:` prefix, even though Temporal's listing spans the whole
`falcone-flows` namespace.

## Endpoints

All routes are workspace-scoped and use the same identity-derived authorization as the rest of the
Flows API (an authenticated tenant principal; the path workspace must belong to the caller's tenant).

| Method | Path | Purpose | Success |
| --- | --- | --- | --- |
| GET | `/v1/flows/workspaces/{workspaceId}/schedules` | List the cron schedules of the workspace's flows. | `200` |
| GET | `/v1/flows/workspaces/{workspaceId}/flows/{flowId}/schedule` | Get a single flow's schedule. | `200` (`404 SCHEDULE_NOT_FOUND` if the flow has no cron schedule) |
| POST | `/v1/flows/workspaces/{workspaceId}/flows/{flowId}/schedule/pause` | Pause the schedule (stops firing). | `200`, `paused: true` |
| POST | `/v1/flows/workspaces/{workspaceId}/flows/{flowId}/schedule/resume` | Resume a paused schedule. | `200`, `paused: false` |
| POST | `/v1/flows/workspaces/{workspaceId}/flows/{flowId}/schedule/trigger` | Request an immediate ad-hoc run. | `202` |

Pause and resume are **idempotent** — pausing an already-paused schedule still returns `200` with
`paused: true`. Neither deletes the flow definition or the schedule. Triggering requests one
immediate run and does not change the recurring cron cadence.

## Response shape

Each schedule is normalized to a small, stable resource. Raw Temporal internals (proto payloads, the
SDK `raw` field) are never exposed; timestamps are ISO-8601 strings.

```json
{
  "scheduleId": "acme:proj-prod:flow-7f3a",
  "flowId": "flow-7f3a",
  "workspaceId": "proj-prod",
  "paused": false,
  "note": null,
  "cron": ["*/5 * * * *"],
  "nextActionTimes": ["2026-06-22T12:00:00.000Z"],
  "recentActions": [
    { "scheduledAt": "2026-06-22T11:55:00.000Z", "takenAt": "2026-06-22T11:55:00.000Z", "workflowId": "acme:proj-prod:flow-7f3a-..." }
  ]
}
```

- `paused` is derived from the Temporal schedule state. A paused schedule reports an empty
  `nextActionTimes`.
- `cron` carries the schedule's cron expression(s), sourced from the **authoritative published flow
  definition** (the cron string the tenant published), not echoed back from Temporal. Temporal
  compiles a cron expression into structured calendars internally and OMITS it from a schedule
  `describe`/`list`, so reading it back from Temporal would always be empty; reading it from the
  stored definition round-trips the tenant's own value. (It is `[]` only for a schedule whose flow
  has no resolvable published cron trigger.) Use `nextActionTimes` for the next scheduled fire times.
- `nextActionTimes` lists upcoming scheduled fire times.
- `recentActions` (when present) lists the most recent started actions (including manual triggers),
  trimmed to `scheduledAt` / `takenAt` / `workflowId`.

The list endpoint returns `{ "items": [ <schedule>, ... ] }` using the same normalized shape per
entry.

`POST .../schedule/trigger` returns a small acknowledgement rather than a schedule resource:

```json
{ "status": "triggered", "scheduleId": "acme:proj-prod:flow-7f3a" }
```

## Examples

Pause a noisy scheduled flow, confirm it is paused, then resume it (the flow definition is never
deleted):

```bash
# Pause -> 200, paused: true
curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE/v1/flows/workspaces/proj-prod/flows/flow-7f3a/schedule/pause"

# Inspect -> paused: true, nextActionTimes: []
curl -sS -H "Authorization: Bearer $TOKEN" \
  "$BASE/v1/flows/workspaces/proj-prod/flows/flow-7f3a/schedule"

# Resume -> 200, paused: false
curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE/v1/flows/workspaces/proj-prod/flows/flow-7f3a/schedule/resume"
```

List every schedule in a workspace (already filtered to the caller's tenant/workspace prefix):

```bash
curl -sS -H "Authorization: Bearer $TOKEN" \
  "$BASE/v1/flows/workspaces/proj-prod/schedules"
```

Request an immediate ad-hoc run:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE/v1/flows/workspaces/proj-prod/flows/flow-7f3a/schedule/trigger"
# -> 202 { "status": "triggered", "scheduleId": "acme:proj-prod:flow-7f3a" }
```

## Errors

| Status | Code | When |
| --- | --- | --- |
| `404` | `SCHEDULE_NOT_FOUND` | The flow has no cron schedule, the flow does not exist, OR the flow/workspace belongs to another tenant (no existence leak). |
| `403` | `CROSS_TENANT_VIOLATION` | The path workspace does not belong to the caller's tenant (enforced by the request gate before the handler runs). |
| `401` | `UNAUTHENTICATED` | No verified tenant identity. |
| `501` | `FLOW_SCHEDULING_DISABLED` | The flow trigger plane (and therefore the schedule gateway) is not wired in this deployment. |
