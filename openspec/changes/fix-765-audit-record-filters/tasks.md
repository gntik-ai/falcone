## 1. Reproduce / encode the contract

- [x] 1.1 Confirm root cause from the issue and source: `metrics-handlers.mjs::auditRecords` read
  only `page[size]`/`limit` and called `queryAuditEvents` without filter parameters.
- [x] 1.2 Confirm the audit store query filtered only by tenant, optional workspace, and limit.
- [x] 1.3 Add regression coverage through `METRICS_HANDLERS.metricsTenantAudit` for
  `filter[outcome]=failed`, unknown outcome values, `filter[actionCategory]`,
  `filter[actorId]`, and `filter[occurredAfter]`/`filter[occurredBefore]`.

## 2. Fix

- [x] 2.1 Parse audit filter query parameters in the metrics audit-records handler.
- [x] 2.2 Pass filters to `queryAuditEvents` without changing the existing tenant/workspace
  authorization guard or limit bounds.
- [x] 2.3 Add parameterized SQL predicates for outcome, actionCategory/action type, actorId, and
  created-at time range filters.
- [x] 2.4 Preserve tenant/workspace scoping and ensure unmatched filter values return no records
  rather than the full unfiltered set.

## 3. Wire, frontend, docs, and OpenSpec

- [x] 3.1 Confirm no frontend code change is needed because the console already sends
  `filter[outcome]`, `filter[actionCategory]`, `filter[actorId]`, and date filters.
- [x] 3.2 Confirm no OpenAPI/source contract change is needed because the filters are already
  declared in the observability audit query surface and generated metrics OpenAPI.
- [x] 3.3 Add architecture documentation for audit-record filter behavior.
- [x] 3.4 Materialize this OpenSpec change under
  `openspec/changes/fix-765-audit-record-filters/`.

## 4. Verify

- [x] 4.1 Run the focused black-box audit test.
- [x] 4.2 Run `openspec validate fix-765-audit-record-filters --strict`.
- [x] 4.3 Run `npm run validate:public-api`.
- [x] 4.4 Run `npm run validate:openapi`.
- [x] 4.5 Run `npm run generate:public-api` and confirm no generated diff.
- [x] 4.6 Run `git diff --check`.
