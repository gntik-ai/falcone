## Why

Tenants and operators need per-tool-call logs, latencies, and per-OAuth-client audit trails for hosted MCP servers — fed from the runtime (#388) and gateway (#389) into Falcone's existing observability + audit pipeline rather than a parallel stack. This resolves issue **#398** (epic #386).

## What Changes

- **MCP becomes a first-class observability + audit subsystem.** Add the `mcp` audit subsystem to the audit pipeline roster, query surface (console filter), event schema, and the audit-traceability matrix; add an `mcp_tool_usage` business-metrics domain + `in_falcone_mcp_tool_invocations_total` metric family — all kept green by the repo's observability validators and contract unit tests.
- **Per-tool-call telemetry.** A pure helper shapes each tool call into a usage-counter increment, a tool-latency observation on the normalized component-latency family (`in_falcone_component_operation_duration_seconds`, `subsystem=mcp`), and a structured log line — all attributed to tenant / workspace / server / tool / oauth-client, with **no PII / high-cardinality labels** (the metrics-stack forbidden-label policy).
- **Per-OAuth-client audit trail.** A pure helper emits `mcp`-subsystem audit events (actor = oauth-client, scope envelope, resource, action, result) for client/consent/scope/server lifecycle, mapped to the audit-event-schema categories.
- **Tenant-scoped queries.** The audit query pins the verified tenant id (never caller input); a defense-in-depth filter drops any cross-tenant record — tenant A cannot see tenant B's MCP audit.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `mcp`: add **observability + audit** — first-class `mcp` audit subsystem and `mcp_tool_usage` metric family, per-tool-call telemetry (usage + latency + log) and a tenant-scoped per-OAuth-client audit trail. Builds on the foundational `mcp` capability (#387), runtime (#388), gateway (#389), OAuth (#390).

## Impact

- **internal-contracts:** `observability-audit-pipeline.json` (mcp roster), `observability-audit-query-surface.json` (mcp filter value), `observability-audit-event-schema.json` (mcp subsystem id), `observability-business-metrics.json` (mcp_tool_usage domain + family + bounded dims), `tests/reference/audit-traceability-matrix.yaml` (mcp). Validator REQUIRED lists updated for `mcp` so it is genuinely enforced (audit-pipeline + business-metrics libs).
- **control-plane:** `apps/control-plane/src/mcp-observability.mjs` (pure telemetry/audit shaping + tenant-scoped query + isolation filter) + tests.
- **Out of scope:** new alerting policies beyond the existing threshold-alert machinery; the console audit views ride the existing audit query surface (#397).
