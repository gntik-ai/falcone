## 1. MCP as a first-class audit subsystem

- [x] 1.1 `observability-audit-pipeline.json`: add `mcp` to `subsystem_roster` (required categories ⊆ schema action.categories; scope_attribution both; positive freshness) + `observability-audit-pipeline.mjs` `REQUIRED_SUBSYSTEM_IDS += 'mcp'`
- [x] 1.2 Align the closed set: `tests/reference/audit-traceability-matrix.yaml` `required_subsystems += mcp`; `observability-audit-query-surface.json` subsystem filter `allowed_values += mcp`; `observability-audit-event-schema.json` `resource.supported_subsystem_ids += mcp`

## 2. MCP usage metric family

- [x] 2.1 `observability-business-metrics.json`: add `mcp_tool_usage` domain + `in_falcone_mcp_tool_invocations_total` family (usage, producer mcp, base+bounded labels, tenant_id/workspace_id optional) + bounded_dimension_catalog (`domain += mcp_tool_usage`, `feature_area += mcp`) + `observability-business-metrics.mjs` REQUIRED lists
- [x] 2.2 Latency rides the normalized `in_falcone_component_operation_duration_seconds` family (subsystem=mcp) — no new scrape subsystem / dashboard widget (avoids chart coupling)

## 3. Per-tool-call telemetry + tenant-scoped audit (control-plane)

- [x] 3.1 `mcp-observability.mjs`: `mcpToolCallTelemetry` (usage metric + latency + log, attributed to tenant/workspace/server/tool/oauth-client, forbidden-label guard); `mcpAuditEvent` (mcp-subsystem, oauth-client actor, schema categories); `buildTenantScopedMcpAuditQuery` (pins verified tenant) + `filterAuditRecordsForTenant` (cross-tenant isolation)
- [x] 3.2 Unit tests (9): attribution, no-forbidden-label, status_class, audit-event shape + category mapping + anon rejection, tenant-pinned query, cross-tenant filter

## 4. Verify

- [x] 4.1 All observability validators pass; observability/audit contract unit tests pass (82); business-metrics count test updated to the genuine new totals (10 domains / 10 families)
- [x] 4.2 `pnpm lint` + `openspec validate --strict` pass; control-plane co-located tests 57/57

## 5. Finalize

- [x] 5.1 Note: latency on the normalized family (no scrape subsystem) is deliberate to avoid chart/dashboard coupling; a dedicated `mcp_tool_invocation` audit category + MCP dashboard widget are follow-ups when traffic warrants
