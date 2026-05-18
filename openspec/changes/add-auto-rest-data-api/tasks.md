# Tasks — add-auto-rest-data-api

- [ ] **T01** Confirm baseline green (`corepack pnpm validate:repo`, `lint`, `test:unit`).
- [ ] **T02** Author `apps/control-plane/openapi/families/data.openapi.json` (`/v1/data/*`)
      and extend `postgres.openapi.json` with exposed-tables / policies CRUD.
- [ ] **T03** Implement `services/adapters/src/postgres-filter-parser.mjs` with
      property-based tests against the PostgREST operator vector set.
- [ ] **T04** Extend `services/adapters/src/postgresql-data-api.mjs` with
      table-scoped routes, exposure cache, JWT-claim propagation, and pagination.
- [ ] **T05** Extend `services/adapters/src/postgresql-governance-admin.mjs` with
      RLS policy CRUD endpoints.
- [ ] **T06** Migration `services/provisioning-orchestrator/src/migrations/NNN-exposed-data-entities.sql`.
- [ ] **T07** Wire APISIX route `/v1/data/{workspaceId}/...` (passes through
      `tenant-api-key` plugin from [[add-tenant-api-keys]]).
- [ ] **T08** Add capability module `services/openapi-sdk-service/src/capability-modules/data-api.paths.json`;
      teach the SDK regenerator to mount per-workspace exposed-table operations.
- [ ] **T09** Add plan dimensions `data_api.requests_per_minute`,
      `data_api.payload_bytes_max`, `data_api.max_rows_per_request`.
- [ ] **T10** Console page `ConsoleDataApiPage.tsx` with per-table publish toggle,
      operation matrix, max-rows slider, allow-anon switch, and policy editor.
- [ ] **T11** Contract tests: PostgREST-compatible operator set; RLS bypass for
      service_role; row-level filtering for anon vs. authenticated; cursor pagination.
- [ ] **T12** Security review: filter parser injection attempts, identifier escape,
      multibyte filter values, JSON-claim injection through Bearer tokens.
- [ ] **T13** Run `openspec validate --strict` and re-run baseline validators.
