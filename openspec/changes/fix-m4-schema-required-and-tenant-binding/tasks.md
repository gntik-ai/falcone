## 1. Failing tests

- [ ] 1.1 [test] Add `tests/contracts/metrics-schema-required.test.mjs`
      that asserts `MetricSeriesResponse` includes `unit` in its `required`
      array and that a sample payload missing `unit` fails validation
      (proves B3).
- [ ] 1.2 [test] Add a case that asserts every workspace response schema
      under `metrics.openapi.json` (enumerated by name suffix
      `Workspace*Response`) includes `tenantId` in both `properties` and
      `required` (proves B4).
- [ ] 1.3 [test] Add `tests/contracts/metrics-tenant-binding.test.mjs`
      that asserts every operation matching the path prefix
      `/v1/metrics/workspaces/{workspaceId}` declares
      `x-tenant-binding: required` (proves B5).

## 2. Implementation

- [ ] 2.1 [fix] Edit `metrics.openapi.json:1297-1303` to add `unit` to
      the `required` array of `MetricSeriesResponse`; keep the existing
      constraints.
- [ ] 2.2 [fix] Edit `metrics.openapi.json:2079` to add `tenantId:
      {type: string, format: uuid}` to
      `WorkspaceEventDashboardResponse.properties` and to the schema's
      `required` array; do the same for any other workspace response
      that currently omits the field.
- [ ] 2.3 [fix] Edit `metrics.openapi.json:3749, :3878, :4006` to add
      `x-tenant-binding: required` to the three workspace observability
      routes that currently omit it.
- [ ] 2.4 [impl] In the handlers introduced by
      `complete-m4-metrics-handlers`, populate the new `tenantId` field
      from `x-falcone-tenant-id` and the new `unit` field from the
      recorder's metric metadata; reject requests where the header is
      absent.
- [ ] 2.5 [migration] Regenerate the merged
      `apps/control-plane/openapi/control-plane.openapi.json` and verify
      the merged spec reflects the three changes.

## 3. Validation

- [ ] 3.1 [docs] Update the changelog comment block in
      `metrics.openapi.json` (or create one) noting the schema additions
      and the contract version bump.
- [ ] 3.2 [test] Run `corepack pnpm lint`, the contract suite, and
      `openspec validate fix-m4-schema-required-and-tenant-binding --strict`;
      all green before merge.
