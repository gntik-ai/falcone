## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add a test in
      `services/adapters/tests/postgresql-data-api-bulk-tenant.test.mjs`
      that calls `bulk_insert` with rows from two different tenant ids
      under one role; assert the emitted SQL contains a per-row
      `tenantId = $sessionContextTenantId` check and that any row whose
      tenant differs would be rejected (proves B-S3.2 at
      `services/adapters/src/postgresql-data-api.mjs:1108-1138`).
- [ ] 1.2 [test] Add a test that supplies a malformed base64url cursor;
      assert the data-API request returns HTTP 400 `INVALID_CURSOR` and
      does not throw a `SyntaxError` (proves B-S3.3 at `:707`).
- [ ] 1.3 [test] Add a test that supplies an `in` filter with 10,001
      elements; assert the adapter raises a bound-exceeded error
      (proves B-S3.5 at `:657-662`) and that the request returns HTTP 400.
- [ ] 1.4 [test] Add a test that invokes `rpc` without an explicit
      `requireRls: false` opt-in; assert the emitted plan binds a
      session-tenant parameter or refuses to execute when no policy
      governs the routine target (proves B-S3.4 at `:1190-1191`).
- [ ] 1.5 [test] Add a test that calls `list` with a join to a relation
      that has no applicable policy for the actor; assert the adapter
      raises `RlsJoinTargetUngovernedError` (proves G-S3.6 at
      `:750-762`).

## 2. Implementation

- [ ] 2.1 [fix] Add a per-row tenant-equality predicate to the bulk
      plan emitted at `postgresql-data-api.mjs:1108-1138` and reject
      cross-tenant rows in `bulk_insert` / `bulk_update` / `bulk_delete`.
- [ ] 2.2 [fix] Wrap cursor decoding at `postgresql-data-api.mjs:701-708`
      in try/catch; on failure return HTTP 400 `INVALID_CURSOR`.
- [ ] 2.3 [fix] Make `rpc` enforce RLS-equivalent semantics by default
      at `:1190-1191`; opt-out MUST require `requireRls: false` plus
      `platform_operator` role.
- [ ] 2.4 [fix] Cap the `in` filter at a configurable maximum (default
      1000) at `:657-662`; reject larger inputs.
- [ ] 2.5 [fix] Validate the CSV delimiter at `:1482` against
      `[',', ';', '\t', '|']`; reject other inputs and apply a default
      row limit to `export` COPY-TO-STDOUT at `:1550-1551` (default
      1,000,000).
- [ ] 2.6 [fix] Validate join-target RLS at `:750-762`: raise
      `RlsJoinTargetUngovernedError` when a joined relation has no
      applicable policy for the actor.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the bulk tenant-equality contract, RPC RLS
      default, cursor / `in` / export bounds, and join policy in
      `services/adapters/src/README.md`.
- [ ] 3.2 [test] Run targeted tests plus
      `openspec validate harden-d1-data-api-quotas-and-bulk --strict`;
      both green before merge.
