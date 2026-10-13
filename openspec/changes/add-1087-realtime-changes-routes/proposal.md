# Publish authorized realtime change streams

## Why

Issue #1087 identifies two existing executor SSE operations used by the console's
EventSource client that were absent from the public routing specification, route
catalog, taxonomy and OpenAPI. Publishing the PostgreSQL operation also requires
authorization before starting a stream: the capture connection has administrative
privileges and does not enforce the API key's row policies per event.

## What changes

- Publish collection and table GET `/changes` operations in the dedicated
  `realtime-changes` routing and taxonomy family, with `control_api` as upstream.
  Collection events are `insert`, `replace`, `delete`; table events are `insert`,
  `update`, `delete`. Both carry `{type, documentId, document}`.
- Keep credential verification and workspace binding in the executor dispatcher.
  Selected header API keys take precedence over query keys. Only `flc_` query
  values are considered on SSE routes; verified bearer sessions remain supported
  when no API key is selected. Document JSON authentication and authorization
  errors, `501 REALTIME_DISABLED`, and terminal initialization error frames.
- Limit the gateway plugin exception to `realtime-changes`. Require cors,
  limit-count with HTTP 429, client-control, blanked identity headers and gateway
  attestation in proxy-rewrite, a `/changes$` URI constraint, and GET/OPTIONS only.
  Other families retain their existing authentication and request validation.
- Before table SSE headers, query the catalog with parameterized schema, table
  and credential database role. Require an existing table, schema USAGE and table
  SELECT. Refuse API-key access to RLS-enabled tables and shared database fallback.
  Denials execute no capture DDL. Dedicated workspace databases isolate PostgreSQL
  notification channels between workspaces of the same tenant.

## Scope and risk

R2 depends on the PostgreSQL precheck. Anon and service API keys are supported for
SELECT-authorized, RLS-disabled tables; enforcing row policies per event is outside
this change. Existing document WAL consumption, update-to-replace mapping, capture
trigger/NOTIFY mechanism, capture management routes, and console remain unchanged.

The paired `gntik-ai/falcone-charts` change installs enabled APISIX routes and values,
answers OPTIONS through cors, rejects other methods, and supplies a long SSE
upstream timeout and per-key limits. Its tracking reference and deployed connection
caps remain publication handoff items. Staging exposure also depends on the #1118
gateway access-log redaction change. Application logs must not disclose query keys.

Staging verification must cover both event sequences, JSON 401/403, method routing,
log redaction and reclassification of inventory `endpoints[224]` from NO_ROUTE to OK.
These are conditional on the paired chart change. Rollback disables the chart route
entries; leaving the executor unset yields JSON `501 REALTIME_DISABLED`.

## Follow-up review

The previous source implementation is commit
`31dac207c481060600d367ab4d3cf35a07c72445`, based on
`7c6d01dcaed747b154237cd2e2809ba2b38a6752`. This follow-up preserves that implementation
and adds the missing OpenSpec proposal, tasks and spec delta. See `tasks.md` for
bounded verification evidence and environment limits.
