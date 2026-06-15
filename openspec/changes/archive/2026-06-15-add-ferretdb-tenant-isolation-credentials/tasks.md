> IMPLEMENTATION NOTES (code-verified during apply):
> - The orchestrator provisions per-domain via the **artifact-driven reprovision pipeline**
>   (`reprovision/registry.mjs` + `tenant-config-reprovision.mjs`), not a bespoke "onboard"
>   hook. `documentdb_identity` is registered there (flag-gated, default off) + in the
>   `tenant-purge-sweep` teardown plan. The loop skips domains absent from a tenant artifact,
>   so this is inert until enabled — default behavior unchanged.
> - Co-located `*.test.mjs` files are NOT run by any CI runner here; the applier unit test
>   lives in `tests/unit/` (run by `pnpm test:unit`) and the public-surface test in
>   `tests/blackbox/`.
> - Engine-level assertions (real Postgres LOGIN role, old-credential rejection) require a
>   live engine → kind E2E / tests/env, not the offline blackbox suite (task 7.6 honored).

## 1. Prerequisites and gating checks

- [x] 1.1 Dependency premises verified against code (refs in proposal/design are accurate:
      `mongoUri`, `applyTenantScopeToFilter:620`, `injectTenantIntoDocument:655`,
      scoped_credential:136/138, postgres-applier RESOURCE_TYPES, no pre-existing identity
      applier). Naming convention `falcone_doc_{tenantId}` implemented in `documentdbUserName`.
- [x] 1.2 `add-ferretdb-documentdb-engine` merged; engine deployed to the kind `falcone`
      namespace (image/version match the spike) — see §8 live run.
- [x] 1.3 `add-ferretdb-gateway` merged; FerretDB gateway deployed to kind; engine-gate
      initContainer blocks the gateway until the engine is ready (observed Init:0/1) — §8.
- [x] 1.4 GUC names `documentdb.enableUserCrud`/`documentdb.maxUserLimit` — the applier does
      NOT depend on a GUC pre-check; it is fail-closed on the `createUser` command result
      itself (more robust than gating on an unverified GUC name). Live `SHOW` recorded in §8.
- [x] 1.5 Credential storage: per-tenant DSN/secret via the externally-provisioned
      `in-falcone-ferretdb` (DSN) + `in-falcone-documentdb` (admin) secrets (ESO/Vault
      pattern, ADR-9); env-var names documented in the applier + main.mjs headers.

## 2. DocumentDB identity applier (net-new)

- [x] 2.1 `services/provisioning-orchestrator/src/appliers/documentdb-identity-applier.mjs`
      with `provisionTenantIdentity` / `rotateTenantIdentityCredential` / `revokeTenantIdentity`
      over an injectable wire-protocol client (NOT Postgres DDL; NOT `postgres-applier`).
- [x] 2.2 Idempotency via `usersInfo` — re-provision is a no-op (no duplicate createUser).
- [x] 2.3 Fail-closed: any createUser/updateUser/dropUser failure throws
      `DOCUMENTDB_IDENTITY_PROVISION_FAILED` (Design D5).
- [x] 2.4 Module header documents: credential = least-privilege auth/audit;
      `applyTenantScopeToFilter`/`injectTenantIntoDocument` remain the authoritative boundary.
- [x] 2.5 Unit tests (`tests/unit/documentdb-identity-applier.test.mjs`) — 11 tests: provision,
      idempotent, fail-closed, rotation, revocation, no-op offboarding, apply/teardown adapters.

## 3. Credential storage (Vault/ESO)

- [x] 3.1 `provisionTenantIdentity` generates a `node:crypto` password, issues createUser,
      writes to the injected secret store, returns a one-time envelope; plaintext never
      persisted relationally.
- [x] 3.2 `rotateTenantIdentityCredential`: updateUser + version bump + secret update +
      `credential_rotation` audit event (`rotationReason`).
- [x] 3.3 Fixtures use random base64url passwords (non-provider-shaped) — no push-protection risk.

## 4. Tenant lifecycle wiring

- [x] 4.1 `documentdb_identity` registered in `reprovision/registry.mjs` (flag
      `CONFIG_IMPORT_DOCUMENTDB_IDENTITY_ENABLED`, default off) + `APPLIER_ORDER` after
      `postgres_metadata`; fail-closed surfaces as an `error` DomainResult.
- [x] 4.2 Teardown wired into `tenant-purge-sweep` TEARDOWN_PLAN (dropUser).
- [x] 4.3 No-op offboarding: `revokeTenantIdentity` returns `alreadyAbsent` cleanly.

## 5. Executor wiring — per-tenant credential resolution

- [x] 5.1 `main.mjs` `resolveMongoUriForTenant(workspaceId, identity)` prefers a per-tenant
      secret-mounted URI (`FERRETDB_TENANT_URI__<tenantId>`), falls back to shared MONGO_URI;
      `mongo-data-executor.mjs` threads `identity` to `resolveUri` (additive, back-compatible).
- [x] 5.2 `applyTenantScopeToFilter`/`injectTenantIntoDocument` confirmed unchanged + active;
      dual-isolation invariant asserted in the blackbox test (bbx-ferretdb-dual-isolation).

## 6. Back-fill script

- [x] 6.1 `scripts/backfill-ferretdb-tenant-identities.mjs` (testable `runBackfill` core + thin
      main-guard), iterates active tenants lacking a credential, masks plaintext by default.
- [x] 6.2 `--force-rotate` flag (default off; resolves OQ1) with the documented session-drop caveat.

## 7. Blackbox and real-stack tests

- [x] 7.1 Blackbox provision test (one-time envelope; idempotent re-provision delivers none).
- [x] 7.2 Rotation test (updateUser + version bump). Old-credential rejection is live-only → §8.
- [x] 7.3 Revocation test (dropUser; no-op when absent). Live pg_roles assertion → §8.
- [x] 7.4 App-layer isolation: dual-isolation invariant test (filter scoped to caller tenant,
      forged tenantId rejected 403). Live two-tenant data-api probe → §8.
- [x] 7.5 Dual-isolation invariant asserted (app-layer scope applied regardless of credential).
- [x] 7.6 No engine-level cross-namespace rejection test written (ADR-14 — would be incorrect).

## 8. Real-stack proof on kind (full-stack E2E)

Deployed documentdb engine + ferretdb gateway to the live kind `falcone` release and ran
the REAL applier through the gateway. LIVE-VERIFIED:
- `hello` → maxWireVersion 21; engine-gate initContainer blocks the gateway until
  `documentdb_api` present (task 7.3); readiness probe `/debug/healthz:8088` passes (task 1.2).
- GUCs confirmed (task 1.4): `documentdb.enableUserCrud=on`, `documentdb.maxUserLimit=100`,
  `shared_preload_libraries=pg_cron,pg_documentdb_core,pg_documentdb`.
- TWO BUGS FOUND + FIXED:
  1. `CREATE EXTENSION documentdb` only works in the **`postgres`** database (pg_cron is
     bound to `cron.database_name='postgres'`), NOT `in_falcone`. Fixed the gateway DSN +
     engine-gate to target `postgres`. (The merged #468 engine init-Job targets `in_falcone`
     → it FAILS on a real cluster: a follow-up fix to add-ferretdb-documentdb-engine.)
  2. wire-protocol `createUser` provisions a Postgres **SUPERUSER** (verified `\du`), NOT the
     non-superuser/non-BYPASSRLS role the spec/ADR-14 assumed. Added least-privilege
     enforcement: the applier demotes via `ALTER ROLE … NOSUPERUSER NOBYPASSRLS` over an
     injected pg connection (fail-closed). FerretDB image needed numeric `runAsUser: 1000`.
- [x] 8.1 Provisioned tenants live: provision → idempotent re-provision (no new cred) →
      rotate (v2) → revoke (role dropped) → revoke-missing (clean no-op) all succeeded
      through the live gateway. FULL DATA-API ROUND-TRIP completed: built+pushed the REAL
      executor image (apps/control-plane main.mjs), repointed it at the FerretDB gateway, and
      drove insert+list through it → documents persisted in FerretDB/DocumentDB, with the app
      layer stamping `tenantId`. CROSS-TENANT ISOLATION proven live (task 7.4): `ten_e2e`'s
      LIST returns only its own doc, never `ten_other`'s — app-layer scoping is authoritative.
      (Engine-gate + readiness validated earlier. NOTE: the data-api was initially blocked by
      the ferretdb NetworkPolicy — kindnet ENFORCES NetworkPolicy on this cluster, and the
      cluster's executor pod uses `app:` labels, not the canonical `app.kubernetes.io/name`
      the NP allow-list expects; fixed for the run by labeling the executor pod.)
- [x] 8.2 The applier returns the plaintext only in a one-time envelope + writes it to the
      secret store; it never persists plaintext relationally (code property; unit-asserted).
- [x] 8.3 Fail-closed verified: createUser failure AND least-privilege demotion failure both
      throw `DOCUMENTDB_IDENTITY_PROVISION_FAILED` (unit tests); no credential handed out.
- [x] 8.4 LEAST-PRIVILEGE confirmed live: after demotion, `pg_roles` shows
      `rolsuper=false, rolbypassrls=false, rolcanlogin=true` for the per-tenant role.

## 9. Optional RLS hardening (operator decision)

- [x] 9.1 Documented in the applier header: activation of `ENABLE/FORCE ROW LEVEL SECURITY` on
      `documentdb_data` with the non-BYPASSRLS `falcone_app` role + `app.tenant_id` GUC
      (`withTenantRlsContext` pattern). Defense-in-depth, not the primary boundary.
- [ ] 9.2 (Optional, operator-gated) RLS zero-row real-stack test — deferred to operator activation.

## 10. Validation

- [x] 10.1 `openspec validate add-ferretdb-tenant-isolation-credentials --strict` — clean.
- [x] 10.2 `bash tests/blackbox/run.sh` — 565/565 green (incl. new tests); `pnpm test:unit` 685/0.
- [ ] 10.3 Real-stack kind slice — see §8 (in progress).
