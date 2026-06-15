## 1. Prerequisites and gating checks

- [ ] 1.1 Verify `add-ferretdb-adr-spike` is merged and ADR-14 findings are recorded — confirm the wire-protocol `createUser`/`dropUser`/`updateUser` command signatures, the logical namespace naming convention (`falcone_doc_{tenantId}`), and the role naming pattern (`falcone_doc_{tenantId}`) on postgres-documentdb 17-0.107.0-ferretdb-2.7.0
- [ ] 1.2 Verify `add-ferretdb-documentdb-engine` is merged and a DocumentDB instance is reachable in `tests/env/` — confirm the engine image and version match the spike
- [ ] 1.3 Verify `add-ferretdb-gateway` is merged and the FerretDB gateway can authenticate a MongoDB wire-protocol connection using the per-tenant credential
- [ ] 1.4 **Verify GUC names `documentdb.enableUserCrud` / `documentdb.maxUserLimit`** (`⚠ not code-verifiable` at spec revision) — issue `SHOW documentdb.enableUserCrud` and `SHOW documentdb.maxUserLimit` against the live engine; record the actual GUC names and their effect on wire-protocol `createUser`; update the identity applier fail-closed guard to use confirmed names
- [ ] 1.5 Confirm the Vault/ESO secret path convention for per-tenant DocumentDB credentials (consistent with ADR-9); document the env-var names in the identity applier module header

## 2. DocumentDB identity applier (net-new)

- [ ] 2.1 Create `services/provisioning-orchestrator/src/appliers/documentdb-identity-applier.mjs` with `provisionTenantIdentity(tenantId, opts)`, `rotateTenantIdentityCredential(tenantId, opts)`, and `revokeTenantIdentity(tenantId, opts)` — issuing MongoDB wire-protocol `createUser` / `updateUser` / `dropUser` commands via an injectable wire-protocol client (NOT Postgres DDL; NOT `GRANT ALL ON DATABASE`; NOT `postgres-applier.mjs` extension)
- [ ] 2.2 Add idempotency check: `provisionTenantIdentity` detects an existing credential for `tenantId` (via `usersInfo` or equivalent wire-protocol command) and returns without issuing duplicate `createUser` or overwriting the existing password
- [ ] 2.3 Add fail-closed guard: if `createUser` fails for any reason (including a confirmed GUC gate from task 1.4), throw `DOCUMENTDB_IDENTITY_PROVISION_FAILED` — never fall through to the shared `MONGO_URI` credential (Design D5)
- [ ] 2.4 Document in the module header that this applier provisions credentials for least-privilege auth and audit; app-layer `applyTenantScopeToFilter` / `injectTenantIntoDocument` remain the authoritative isolation boundary
- [ ] 2.5 Write unit tests for `documentdb-identity-applier.mjs` using a mock wire-protocol client; cover: successful provision, idempotent re-provision, fail-closed on engine error, credential rotation, revocation, and no-op offboarding

## 3. Credential storage (Vault/ESO)

- [ ] 3.1 Implement credential generation in `provisionTenantIdentity`: generate a strong random password via `node:crypto`; issue `db.runCommand({createUser: 'falcone_doc_{tenantId}', pwd: '<pw>', roles:[{role:'readWrite', db:'falcone_doc_{tenantId}'}]})` over the wire protocol; write the password to Vault/ESO as a per-tenant secret; return a one-time secret envelope — never write the plaintext to the relational DB
- [ ] 3.2 Implement `rotateTenantIdentityCredential`: generate a new password; issue `db.runCommand({updateUser: 'falcone_doc_{tenantId}', pwd: '<new>'})` over the wire protocol; update the Vault/ESO secret; emit `credential_rotation` audit event with `rotationReason` field; deliver new credential once via the secret envelope
- [ ] 3.3 Ensure all test fixtures use non-provider credential literals (no `mongodb+srv://`-shaped secrets, no SCRAM-SHA-256-shaped credentials committed) to avoid GitHub push-protection rejections

## 4. Tenant lifecycle wiring

- [ ] 4.1 Wire `provisionTenantIdentity` into the tenant onboarding lifecycle in `services/provisioning-orchestrator/`: call the identity applier after the relational schema is provisioned; fail onboarding if the DocumentDB identity cannot be created (Design D5 fail-closed)
- [ ] 4.2 Wire `revokeTenantIdentity` into the tenant offboarding/deletion lifecycle: issue `dropUser` for `falcone_doc_{tenantId}`, confirm the Postgres login role no longer exists, and delete collections in the logical namespace — confirm deletion before marking the offboarding complete
- [ ] 4.3 Handle no-op offboarding: if no DocumentDB credential exists for the tenant (pre-migration tenant), complete offboarding cleanly without error

## 5. Executor wiring — per-tenant credential resolution

- [ ] 5.1 Update `apps/control-plane/src/runtime/main.mjs` (and the mongo-data executor wiring) to resolve per-tenant DocumentDB credentials via `secretRef` (Vault/ESO env-var pattern, consistent with the embedding-store secret resolver at lines 74–80) instead of the single shared `MONGO_URI` — retain the shared `MONGO_URI` path as a fallback for pre-migration / back-fill-window tenants only
- [ ] 5.2 Confirm that `applyTenantScopeToFilter` and `injectTenantIntoDocument` in `services/adapters/src/mongodb-data-api.mjs:620,655` remain active on all data-api code paths after the credential resolver change — add an assertion in the dual-isolation integration test that both the per-tenant credential and the app-layer filter are in effect simultaneously

## 6. Back-fill script

- [ ] 6.1 Write a one-time back-fill script (`scripts/backfill-ferretdb-tenant-identities.mjs`) that iterates all active tenants lacking a DocumentDB credential and calls `provisionTenantIdentity` for each; skip re-delivery of the plaintext password (masked credential reference only); log tenant IDs that need manual rotation to obtain a usable per-tenant credential
- [ ] 6.2 Add a `--force-rotate` flag (default: no-force-rotate; resolves Design OQ1 pending operator decision); document that force-rotate may cause brief connection drops for active sessions

## 7. Blackbox and real-stack tests

- [ ] 7.1 Write a blackbox test (`tests/blackbox/ferretdb-tenant-identities.test.mjs`) that: provisions a tenant, asserts a DocumentDB credential (Postgres login role, non-superuser, non-BYPASSRLS) exists for that tenant, verifies the credential envelope is returned exactly once (idempotent re-provision delivers no new credential)
- [ ] 7.2 Rotation blackbox test: trigger rotation, assert `credentialVersion` increments, assert the old credential is rejected by the DocumentDB engine after rotation
- [ ] 7.3 Offboarding/revocation blackbox test: delete a tenant, assert the Postgres login role no longer exists (via `pg_roles` or wire-protocol `usersInfo`), assert any credential for the deleted tenant is rejected
- [ ] 7.4 App-layer isolation probe (two-tenant fixture): provision Tenant A and Tenant B with separate credentials; assert that a data-api `find` request authenticated with Tenant A's credential and routed via the executor returns only Tenant A's documents — because `applyTenantScopeToFilter` is applied, not because DocumentDB enforces credential-level namespace isolation
- [ ] 7.5 App-layer dual-isolation invariant test: confirm `applyTenantScopeToFilter` is still invoked on all data-api operations even when the per-tenant credential is in use — both isolation layers must be simultaneously active
- [ ] 7.6 **Do NOT** write a test asserting that Tenant A's credential is rejected by DocumentDB when accessing Tenant B's logical namespace at the engine layer — ADR-14 spike disproved this; such a test would be incorrect and misleading

## 8. Real-stack proof in tests/env

- [ ] 8.1 Real-stack slice: provision two tenants against live FerretDB + DocumentDB in `tests/env/`; exercise the full provision → rotate → revoke lifecycle; confirm that data-api operations return only tenant-scoped data (app-layer isolation confirmed, not DB-layer credential denial)
- [ ] 8.2 Confirm no plaintext credential in the persisted relational record for either tenant (credential reference / masked key only)
- [ ] 8.3 Confirm that a provisioning failure (e.g., engine unreachable) causes `provisionTenantIdentity` to fail-closed — no tenant is activated without a confirmed per-tenant credential

## 9. Optional RLS hardening (operator decision)

- [ ] 9.1 Document in the identity applier header and in an operator runbook (not committed as a doc file) the steps to activate `ENABLE/FORCE ROW LEVEL SECURITY` on `documentdb_data` tables with the non-BYPASSRLS `falcone_app` role and `app.tenant_id` GUC — consistent with the `withTenantRlsContext` pattern in `services/adapters/src/tenant-rls-context.mjs`
- [ ] 9.2 (Optional, operator-gated) Add a real-stack test that activates RLS on `documentdb_data` and confirms zero-row return when `app.tenant_id` GUC is absent or wrong — this test is conditioned on the operator activating RLS hardening

## 10. Validation

- [ ] 10.1 Run `openspec validate add-ferretdb-tenant-isolation-credentials --strict` and fix until clean
- [ ] 10.2 Run `bash tests/blackbox/run.sh` — all new tests green, no regressions in existing `tenant-isolation` and `data-api` contract suites
- [ ] 10.3 Run the real-stack `tests/env/` slice against live FerretDB + DocumentDB; confirm app-layer isolation is enforced and per-tenant credential lifecycle works end-to-end
