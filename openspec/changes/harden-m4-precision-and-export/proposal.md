## Why

Three observability surfaces leave operationally critical details
unspecified or under-served: usage-percentage precision, audit-export
idempotency-key location, and the silent truncation of large audit
correlations. From `openspec/audit/cap-m4-observability-metrics.md`:

- **B14** (`services/internal-contracts/src/observability-quota-usage-view.json:116-124`)
  — `usagePercentage` is computed by dividing by `hardLimit` first then
  `softLimit`, but rounding mode and decimal precision are unspecified.
  Producers using different rounding will disagree on `99.9 % vs
  99.95 %` boundary alerting.
- **B21** (`apps/control-plane/openapi/families/metrics.openapi.json:2401,
  :3322, :444`) — `Idempotency-Key` is required as a header on
  `exportTenantAuditRecords` / `exportWorkspaceAuditRecords`, but the
  `AuditExportRequest` body schema does not include `idempotencyKey`.
  Server-side replay-store lookups (`SELECT ... WHERE
  idempotency_key = ?`) need the key on the request payload to be
  durable across header-handling proxies.
- **B22** (`metrics.openapi.json:2280`) —
  `getTenantAuditCorrelation.maxItems` ≤ 200 with no cursor.
  Correlations spanning more than 200 events are silently truncated;
  clients cannot detect the truncation.
- **G-S1.6/G-S1.8/G-S9.1** — same three issues as design gaps.

## What Changes

- Specify `usagePercentage` precision in
  `observability-quota-usage-view.json`: 2-decimal-place fixed-point
  rounded half-to-even (banker's rounding); document the formula
  pseudocode and add a contract field `usagePercentagePrecision: 2` for
  consumer discovery.
- Add `idempotencyKey` to the `AuditExportRequest` body schema as a
  required field; require its value to equal the `Idempotency-Key`
  header on entry to the handler (mismatch = 400). Persist the body
  field to the replay store as the durable record.
- Add cursor pagination to `getTenantAuditCorrelation` and its
  workspace sibling: a `cursor` query parameter, a `nextCursor` in the
  response, and a `truncated: boolean` flag that is `true` when more
  events exist. The 200-item soft cap remains as the per-page limit.

## Capabilities

### Modified Capabilities

- `observability-and-audit`: requirement on a specified precision for
  `usagePercentage`, on `idempotencyKey` parity between header and
  body for audit exports, and on cursor-paginated audit correlations
  with explicit truncation signalling.

## Impact

- **Affected code**:
  `services/internal-contracts/src/observability-quota-usage-view.json`
  (precision field + formula);
  `apps/control-plane/openapi/families/metrics.openapi.json`
  (`AuditExportRequest.idempotencyKey` + correlation cursor schema);
  the handlers introduced by `complete-m4-metrics-handlers` for the
  three audit-correlation/export operations.
- **Migration required**: callers of `getTenantAuditCorrelation`
  currently relying on the implicit truncation must move to paginating
  on `nextCursor`; document the migration in the change PR.
- **Breaking changes**: audit-export callers must include
  `idempotencyKey` in the body (additive at the contract level, but a
  new required field).
- **Cross-cutting**: depends on `complete-m4-metrics-handlers` for the
  handler layer; the precision change is contract-only and can land
  independently.
