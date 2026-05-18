## Why

Correlation and audit semantics on the workspace capability catalog endpoint
collapse multiple unrelated requests into one observability bucket and silently
drop audit events on Kafka outages. From
`openspec/audit/cap-c2-workspace-capability-catalog.md`:

- **B2** (`services/provisioning-orchestrator/src/actions/workspace-capability-catalog.mjs:66`) —
  the correlation-id fallback synthesises `corr-${workspaceId}`. Every
  request from one workspace that lacks an explicit header collapses onto
  the same correlation id; traces look like one ongoing flow per workspace.
- **B11** (`workspace-capability-catalog.mjs:70-72`) — audit emission is
  fire-and-forget with `.catch(warn-once)`. A persistent Kafka outage
  silently drops every `workspace.capability-catalog.accessed` event with
  no DLQ, no retry, no metric.
- **B12** (`workspace-capability-catalog.mjs:66`) — the
  `params.headers?.['x-correlation-id']` lookup is case-sensitive, but
  HTTP headers are case-insensitive. The gateway route at
  `services/gateway-config/routes/workspace-capability-catalog.yaml:11-12`
  configures `header_name: X-Correlation-Id`; depending on gateway
  case-normalisation the header may not match and the per-workspace
  fallback collision (B2) is triggered.
- **G13** — same root cause as B2: a constant correlation id per workspace
  defeats correlation-based observability.

## What Changes

- Replace the `corr-${workspaceId}` fallback at
  `workspace-capability-catalog.mjs:66` with a UUID v4 (or
  ULID) per request. The synthesised id MUST be unique per call.
- Normalise the incoming header lookup to be case-insensitive so
  `X-Correlation-Id`, `x-correlation-id`, and `X-CORRELATION-ID` all
  resolve to the same value.
- Replace fire-and-forget audit emission at
  `workspace-capability-catalog.mjs:70-72` with a guaranteed-delivery path:
  the emitter MUST either await the publish before returning 200, or write
  the event to a dead-letter table (DLQ) when the broker is unreachable
  so an out-of-band drainer can retry. A persistent broker outage MUST
  NOT silently drop events.

## Capabilities

### Modified Capabilities

- `workspace-management`: correlation-id uniqueness per request,
  case-insensitive header resolution, and durable audit emission for the
  workspace capability catalog endpoint.

## Impact

- Affected code:
  `services/provisioning-orchestrator/src/actions/workspace-capability-catalog.mjs`,
  a shared correlation-id helper if one exists (else a new helper in this
  package), and a new audit DLQ writer (or reuse of an existing one).
- Migrations: a DLQ table (`workspace_capability_catalog_audit_dlq` or
  reuse of a shared `audit_event_dlq`) may be required depending on the
  DLQ strategy chosen.
- Breaking changes: callers that today rely on the deterministic
  `corr-${workspaceId}` fallback as a correlation key will break;
  consumers MUST switch to the per-request id.
- Out of scope: action completion (`complete-c2-action-implementation`);
  schema conformance (`fix-c2-schema-conformance`); cross-service imports
  (`harden-c2-cross-service-coupling`).
