## 1. Failing tests

- [ ] 1.1 [test] Add `tests/contracts/usage-percentage-precision.test.mjs`
      that asserts `observability-quota-usage-view.json` declares
      `usagePercentagePrecision = 2` and that a reference computation of
      `usage / hardLimit` for `(99.99499, 100)` yields `99.99` and for
      `(99.99500, 100)` yields `100.00` (banker's-rounding boundary
      case — proves B14).
- [ ] 1.2 [test] Add `services/metrics-api/test/audit-export-idempotency.test.mjs`
      that asserts `exportTenantAuditRecords` returns 400 when
      `Idempotency-Key` header is present but the body's `idempotencyKey`
      is absent or differs, and that matching header + body succeeds
      (proves B21).
- [ ] 1.3 [test] Add `services/metrics-api/test/audit-correlation-cursor.test.mjs`
      that asserts a correlation with 350 events returns `truncated:
      false, nextCursor: <opaque>`, the follow-up call with that cursor
      returns the remaining 150 events, and the final response has
      `truncated: false, nextCursor: null` (proves B22).

## 2. Implementation

- [ ] 2.1 [fix] Edit
      `services/internal-contracts/src/observability-quota-usage-view.json:116-124`
      to add a `usagePercentagePrecision: 2` field and a `rounding:
      "half_to_even"` field; document the formula in the contract
      description.
- [ ] 2.2 [fix] Edit `metrics.openapi.json:444` to add
      `idempotencyKey: {type: string, minLength: 16, maxLength: 128}` to
      `AuditExportRequest.properties` and to the schema's `required`
      array.
- [ ] 2.3 [fix] Edit `metrics.openapi.json:2280` and the workspace
      sibling to add `cursor: {in: query, schema: {type: string}}` and a
      response schema carrying `nextCursor: string | null, truncated:
      boolean`.
- [ ] 2.4 [impl] In the audit-export handler, assert
      `request.headers['idempotency-key'] === request.body.idempotencyKey`
      on entry; reject with 400 on mismatch; persist the body's
      `idempotencyKey` to the replay store.
- [ ] 2.5 [impl] In the audit-correlation handler, implement cursor
      pagination via Kafka topic offsets: encode `(partition, offset)`
      in the cursor; decode on follow-up calls; set `truncated: false`
      and `nextCursor: null` when the consumer reaches the last record.

## 3. Validation

- [ ] 3.1 [docs] Document the precision rule, the
      header-body idempotency-key parity, and the cursor pagination
      pattern in `apps/control-plane/openapi/families/README.md` (create
      if absent).
- [ ] 3.2 [test] Run `corepack pnpm test:unit`, the metrics-api
      integration tests, and `openspec validate
      harden-m4-precision-and-export --strict`; all green before merge.
