# Storage E2E — running green against SeaweedFS on kind

Change: `add-seaweedfs-storage-e2e` (#439). This suite is **live-gated**: with no auth env
it skips cleanly (like the MCP suite). To run it GREEN against a real SeaweedFS-backed
control-plane, the specs authenticate with real Keycloak-minted JWTs.

## Green result (test-cluster-b, 2026-06-14)

```
✓ sto-e2e-001  list buckets
✓ sto-e2e-002a provision bucket (201)
✓ sto-e2e-002b provisioned bucket appears in list
✓ sto-e2e-003  workspace usage
✓ sto-e2e-004  list objects
✓ sto-e2e-005  object metadata (direct SigV4 upload seed)
-  sto-e2e-xt-01/02/03  cross-tenant isolation  (SKIPPED — see below)
6 passed, 3 skipped
```

Run against the live `falcone` namespace (control-plane `0.6.2`, which serves the storage
routes + SeaweedFS-compatible handler), not the ephemeral `stack.sh` namespace.

## Prerequisites

1. **Keycloak clients** (one per fixture tenant) in realm `in-falcone-platform`, each a
   confidential `service-account` client with hardcoded-claim mappers for `tenant_id` and
   `workspace_id`:
   - `e2e-storage-tenant-a` → `tenant_id=aaaaaaaa-…-aaaaaaaaaaaa`, `workspace_id=aaaaaaaa-…-aaaaaaaaa001`
   - `e2e-storage-tenant-b` → `tenant_id=bbbbbbbb-…-bbbbbbbbbbbb`, `workspace_id=bbbbbbbb-…-bbbbbbbbbb01`

   The control-plane has no issuer/audience check (`KEYCLOAK_ISSUER`/`AUDIENCE` unset), so a
   realm-signed token carrying `tenant_id` is accepted; identity is derived from the JWT claims.

2. **Fixture workspaces** must exist in the control-plane DB (`tenants` + `workspaces` rows for
   A and B) — the provision route returns `WORKSPACE_NOT_FOUND` otherwise. The migration smoke
   (`tests/env/validation/smoke-storage.mjs`) seeds them the same way.

3. **Port-forwards** (or in-cluster addresses): control-plane `:8080`, keycloak `:8080`,
   seaweedfs-s3 `:8333`.

## Invocation

```bash
export E2E_CP_BASE_URL=http://localhost:18081
export E2E_KC_TOKEN_URL=http://localhost:18080/realms/in-falcone-platform/protocol/openid-connect/token
export E2E_S3_ENDPOINT=http://localhost:58333
export E2E_S3_ACCESS_KEY=<in-falcone-seaweedfs-s3-creds:s3AccessKey>
export E2E_S3_SECRET_KEY=<in-falcone-seaweedfs-s3-creds:s3SecretKey>
# Per-tenant client creds default to e2e-storage-tenant-{a,b} / e2e-storage-secret-{a,b};
# override with E2E_KC_CLIENT_ID_{A,B} / E2E_KC_CLIENT_SECRET_{A,B} if different.
cd tests/e2e && npx playwright test specs/issues/add-seaweedfs-storage-e2e.spec.ts --reporter=list
```

## Cross-tenant probes (XT-01/02/03)

These assert Tenant B is denied Tenant A's buckets/objects. That isolation is enforced at the
**S3-credential layer by per-tenant SeaweedFS identities** (`add-seaweedfs-tenant-identities`).
The current deployment signs every request with a single shared root credential, so the
control-plane does NOT deny cross-tenant reads — the probes therefore **skip** unless
`E2E_PER_TENANT_S3=1` is set (matching the migration-validation smoke's `PER_TENANT_S3_CREDS`
gate). Set it once per-tenant identities are deployed to assert the denials.

## Ephemeral `stack.sh` CI path (follow-up)

To run inside the ephemeral `falcone-e2e` namespace via `stack.sh up` instead of the live
namespace, additionally wire: a storage values file (control-plane storage env re-point to
`<release>-seaweedfs-s3:8333` + e2e profile), a Keycloak realm import that pre-creates the two
tenant clients, and fixture-workspace seeding in the setup path. `stack.sh` already enables the
SeaweedFS sub-chart on `E2E_STORAGE_BACKEND=seaweedfs` and tears everything down with the namespace.
