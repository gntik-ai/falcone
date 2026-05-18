## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add `tests/adapters/mongodb-admin.collection-prefix.test.mjs`
      with a case validating a `create_collection` request from workspace A
      naming a collection `wB_orders` under `tenant_database` segregation;
      assert validation rejects with `MONGO_COLLECTION_PREFIX_MISMATCH` — fails
      today (no check exists).
- [ ] 1.2 [test] Add a case passing `context.enforceOwnedPrefix: false` from
      an unprivileged context; assert prefix enforcement is NOT disabled and
      `validateDatabaseRequest` still rejects on mismatched database prefix.
- [ ] 1.3 [test] Add a case under `segregationModel: 'workspace_database'`
      asserting `profile.namingPolicy.collectionPrefix === null` (explicit
      null, not `undefined`).

## 2. Implementation

- [ ] 2.1 [fix] In `services/adapters/src/mongodb-admin.mjs:959-994` add a
      check: when `profile.namingPolicy.collectionPrefix` is non-null and the
      action is `create`/`alter`/`drop`/`get`, push a
      `MONGO_COLLECTION_PREFIX_MISMATCH` violation if
      `!collectionName.startsWith(profile.namingPolicy.collectionPrefix)`.
- [ ] 2.2 [fix] Replace the `context.enforceOwnedPrefix !== false` reads at
      `mongodb-admin.mjs:939` and `:1210` with `isPrefixEnforcementBypassed
      (context)` — a helper that returns `true` only when
      `context.privilegedBypass === true` AND
      `context.privilegedBypassSignedBy` matches the platform-admin identity
      from the profile.
- [ ] 2.3 [fix] At `mongodb-admin.mjs:792` set `collectionPrefix = null` when
      `segregationModel === 'workspace_database'`; document the contract in
      the surrounding JSDoc.
- [ ] 2.4 [impl] Add the `MONGO_COLLECTION_PREFIX_MISMATCH` and
      `MONGO_PRIVILEGED_BYPASS_REJECTED` error codes to `ERROR_CODE_MAP`
      (`services/adapters/src/mongodb-admin.mjs:1595-1626` area).

## 3. Docs and validation

- [ ] 3.1 [docs] Document the prefix-enforcement contract and the privileged
      bypass shape in `apps/control-plane/src/mongo-admin.mjs` JSDoc.
- [ ] 3.2 [test] Re-run `corepack pnpm test:unit` and `openspec validate
      fix-e1-collection-prefix-isolation --strict`; both green before merge.
