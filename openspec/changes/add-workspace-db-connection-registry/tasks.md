## 1. Baseline

- [ ] 1.1 Confirm baseline green: `bash tests/blackbox/run.sh`
- [ ] 1.2 Confirm `openspec validate add-workspace-db-connection-registry --strict` passes

## 2. Black-box tests (write first, against tests/env real-stack Postgres)

- [ ] 2.1 Add test fixture that registers two workspace DSNs pointing at the
      `tests/env` Postgres instance — one DSN per simulated workspace database
- [ ] 2.2 Write black-box test: `acquire(workspaceId, {tenantId, workspaceId}, fn)`
      executes `fn` against the correct workspace database and
      `current_setting('app.tenant_id', true)` returns the expected tenant ID
      inside `fn`
- [ ] 2.3 Write black-box test: `acquire()` for an unregistered workspace ID
      rejects with `{ code: 'WORKSPACE_DSN_UNKNOWN' }` and no Postgres
      connection is opened
- [ ] 2.4 Write black-box test: concurrent `acquire()` calls for workspace A
      and workspace B use separate pool entries and do not share connections
- [ ] 2.5 Write black-box test: after workspace A's transaction commits,
      acquiring the same connection for workspace B (different tenant) sees
      workspace B's `app.tenant_id` (not workspace A's residual value)
- [ ] 2.6 Write black-box test: `acquireMigration(workspaceId, fn)` connects
      with the migrator credential; `current_user` inside `fn` is NOT
      `platform_runtime`
- [ ] 2.7 Write black-box test: `acquire()` for a workspace whose DSN resolves
      to a shared physical database but a different logical database name does
      not reuse pool connections from a workspace on a different DSN
- [ ] 2.8 Confirm all new tests fail before implementation (red-green discipline)

## 3. Extract / co-locate withTenantRlsContext

- [ ] 3.1 Verify that `withTenantRlsContext` is exportable from
      `services/adapters/src/postgresql-data-api.mjs` (or a new shared
      helper) without circular dependency on `postgresql-admin.mjs`
- [ ] 3.2 Export `withTenantRlsContext({ pool, tenantId, workspaceId }, fn)`
      from the chosen module; signature must match the RLS context expected by
      `control.current_tenant_id()` and `control.current_workspace_id()` in
      `docs/reference/postgresql/tenant-isolation-baseline.sql`

## 4. Implement the connection registry

- [ ] 4.1 Create `apps/control-plane/src/workspace-db-connection-registry.mjs`
- [ ] 4.2 Implement `registerWorkspace(workspaceId, { appDsn, migrationDsn })` —
      stores the DSN mapping; idempotent for same-DSN re-registration
- [ ] 4.3 Implement `acquire(workspaceId, { tenantId, workspaceId }, fn)` —
      resolves DSN, gets or creates a `pg.Pool` for the `platform_runtime`
      role, calls `withTenantRlsContext(pool, { tenantId, workspaceId }, fn)`,
      rejects with `WORKSPACE_DSN_UNKNOWN` if no mapping exists
- [ ] 4.4 Implement `acquireMigration(workspaceId, fn)` — resolves
      `migrationDsn`, opens a client with the `platform_migrator` credential,
      calls `fn(client)`, always releases the client; annotated with
      `// BYPASSRLS — migration/admin path only`
- [ ] 4.5 Implement `drain(workspaceId)` — ends the pool for a given workspace
      (for use during workspace teardown)
- [ ] 4.6 Implement `close()` — drains all pools (for graceful executor shutdown)
- [ ] 4.7 Enforce pool cap: `max: 5` per pool entry; add a `maxPools` guard
      that evicts the LRU entry when the pool map exceeds the configured limit

## 5. Wire into the executor

- [ ] 5.1 Update the executor (add-control-plane-executor) to import
      `acquire` and `acquireMigration` from the registry instead of opening
      raw Postgres connections
- [ ] 5.2 Ensure the executor never holds a direct reference to a `pg.Pool` or
      `pg.Client` — all Postgres access goes through the registry

## 6. Integration validation

- [ ] 6.1 Run `bash tests/blackbox/run.sh` — all new and existing tests pass
- [ ] 6.2 Run `openspec validate add-workspace-db-connection-registry --strict`
