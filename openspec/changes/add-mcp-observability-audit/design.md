## Context

Falcone's observability + audit is contract-driven: JSON contracts in `services/internal-contracts/src/observability-*.json` are cross-checked by `scripts/validate-observability-*.mjs` (via `pnpm lint`) and contract unit tests (`tests/unit/observability-*`). Capabilities (iam, postgresql, storage, realtime, …) are first-class entries in those contracts. MCP must join them rather than ship a parallel pipeline.

The validators are tightly coupled; the safe edit set was derived by reading each validator:
- **Audit roster is a closed set vs. the traceability matrix**: `audit-traceability.mjs` requires `audit-traceability-matrix.yaml` `required_subsystems` to *exactly equal* the pipeline `subsystem_roster` ids → both move together.
- **Query-surface subsystem filter ⊆ roster**; **event-schema `action.categories` ⊇ every roster `required_event_categories`** → mcp's required categories reuse existing schema categories (resource_creation/deletion, configuration_change, access_control_modification).
- **Metrics-stack subsystems couple to chart `values.yaml` componentTargets**, and **dashboard widgets couple to metrics-stack subsystems** → adding mcp as a *scrape subsystem* would force chart + widget edits. Avoided: MCP tool latency rides the existing **normalized** `in_falcone_component_operation_duration_seconds` family with a bounded `subsystem=mcp` label (no new scrape target), and MCP volume is a **business-metrics** family (no dashboard-per-domain requirement in the dashboards validator).

## Goals / Non-Goals

**Goals:** MCP first-class + genuinely validated in the audit + business-metrics contracts; a pure per-tool-call telemetry/audit shaper attributed to tenant/workspace/server/tool/oauth-client with no PII labels; a tenant-scoped audit trail with a cross-tenant isolation guard.

**Non-Goals:** a new scrape subsystem / Prometheus target / dashboard widget for MCP (rides normalized families); new alerting policies; the console audit UI (uses the existing audit query surface, #397); the runtime/gateway OTel wiring (this defines the shape the emitters target).

## Decisions

- **First-class, not tolerated.** Add `mcp` to the validator REQUIRED lists (audit-pipeline `REQUIRED_SUBSYSTEM_IDS`; business-metrics `REQUIRED_DOMAIN_IDS` + `REQUIRED_METRIC_FAMILY_IDS`) so a regression dropping MCP is caught — matching how every existing capability is enforced.
- **Latency on the normalized family.** Tool latency = `in_falcone_component_operation_duration_seconds` with `subsystem=mcp` + bounded `tool_name`/`oauth_client`/`status_class`; avoids a chart-coupled scrape subsystem while staying per-tool attributable.
- **Forbidden-label guard in code.** `mcpToolCallTelemetry` asserts none of `{user_id, request_id, raw_path, object_key, email, api_key_id}` is present; `oauth_client` is a bounded client id (allowed) — the agent's contract for tenant-safe cardinality.
- **Tenant pinned, not trusted.** `buildTenantScopedMcpAuditQuery` sets `tenant_id` from the verified context and ignores any caller value; `filterAuditRecordsForTenant` is defense-in-depth so a mis-scoped upstream record is still dropped (ADR-2; criterion 4).

## Risks / Trade-offs

- *Audit category fit*: a tool *invocation* has no dedicated audit category; the audit trail covers OAuth-client/server lifecycle (creation/deletion/config/consent) which map cleanly, while per-call signal is the metric + log. Invocation-failure is an optional category for later.
- *No live cluster proof*: pure contract + logic change; verified by the full validator suite + contract unit tests + module unit tests (no runtime to exercise here).

## Migration Plan

Additive: new contract entries (no version bump — cross-file version alignment preserved), validator REQUIRED-list additions, one pure module + tests, one matrix line. No data migration.

## Open Questions

- Whether to add a dedicated `mcp_tool_invocation` audit category (and a scrape subsystem + dashboard widget) once MCP traffic justifies a first-class dashboard, vs. the current normalized-family approach.
