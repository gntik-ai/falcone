## 1. Prerequisites and gating checks

- [x] 1.1 Verify `add-seaweedfs-deployment` is merged and a SeaweedFS instance is reachable in `tests/env/` — archived `2026-06-14-add-seaweedfs-deployment`; `tests/env/seaweedfs/run.sh` boots a pinned gateway
- [x] 1.2 Verify `add-seaweedfs-bucket-lifecycle-migration` is merged and `workspace_buckets` table exists with at least one test row — archived `2026-06-14-add-seaweedfs-bucket-lifecycle-migration` (#435); reconciler reads `workspace_buckets`
- [x] 1.3 Verify `add-seaweedfs-storage-adr-spike` is merged and the `s3.configure` write/reload prototype is available for reference — archived `2026-06-14-add-seaweedfs-storage-adr-spike`; `conf/s3-identities.json` + `evidence/10-identities-live-reload.txt`
- [x] 1.4 Confirm the SeaweedFS admin endpoint + credential to use for the IAM client (resolves Design OQ2); document the env-var names in `services/adapters/src/seaweedfs-iam-client.mjs` — env-var names documented (`SEAWEEDFS_S3_ADMIN_ENDPOINT`/`SEAWEEDFS_ADMIN_ACCESS_KEY`/`SEAWEEDFS_ADMIN_SECRET_KEY`). NOTE: the exact admin wire protocol/endpoint is still OQ2 (deferred to deployment); the client uses an injectable transport with a documented default HTTP contract

## 2. SeaweedFS IAM client module

- [x] 2.1 Create `services/adapters/src/seaweedfs-iam-client.mjs` with `writeIdentity(identity)`, `deleteIdentity(name)`, and `reloadIdentities()` functions using `node:crypto` for signing (no SDK); wire env vars `SEAWEEDFS_S3_ADMIN_ENDPOINT`, `SEAWEEDFS_ADMIN_ACCESS_KEY`, `SEAWEEDFS_ADMIN_SECRET_KEY`
- [x] 2.2 Add retry logic (exponential back-off, max 3 attempts) to `writeIdentity` and `deleteIdentity` so transient reload timeouts surface as provisioning failures, not silent successes
- [x] 2.3 Add fail-closed guard: throw `INVALID_IDENTITY_SCOPE` if `identity.buckets` is empty or contains `"*"` (spec: `tenant-isolation` scenario "Absent or empty bucket scoping is rejected at identity write time") — also fail-closed on an empty action set
- [x] 2.4 Write unit tests for `seaweedfs-iam-client.mjs` using a mock HTTP server; cover: successful write+reload, retry on 5xx, fail-closed on empty bucket list — `tests/adapters/seaweedfs-iam-client.test.mjs` (real `node:http` mock server)

## 3. Action mapping from storage-access-policy

- [x] 3.1 Add `toSeaweedFSActions(policyDecisions)` helper in `services/adapters/src/storage-access-policy.mjs` mapping `{read, write, list, admin}` booleans to `["Read","Write","List","Admin"]` subset (Design D5)
- [x] 3.2 Write unit tests for `toSeaweedFSActions` covering all permission combinations including empty (should return `[]`, which triggers the fail-closed guard in 2.3) — `tests/adapters/storage-access-policy-seaweedfs-actions.test.mjs`

## 4. Implement provisionWorkspaceStorageBoundary

- [x] 4.1 Replace the `NOT_YET_IMPLEMENTED` stub in `services/adapters/src/storage-tenant-context.mjs:465-469` with a real implementation that: (a) looks up the workspace bucket name from `workspace_buckets` (via injected `resolveBucketName`), (b) generates `accessKey`/`secretKey` via the credential builder, (c) calls `seaweedfs-iam-client.mjs::writeIdentity` with `actions` from `toSeaweedFSActions` and `buckets: [bucketName]`, (d) reloads (the IAM client reloads internally), (e) persists `accessKeyIdMasked` + `secretVersion: 1` (via injected `persistCredential`), (f) returns a one-time `buildStorageProgrammaticCredentialSecretEnvelope`. NOTE: implemented as a collaborator-injectable async fn (single input object, matching the wf-con-003 call site) since the adapter layer is pure/DB-less — the DB-bound bucket lookup + persistence are supplied by the real deployment
- [x] 4.2 Guard idempotency: if an active credential record already exists for the workspace, return it without calling `writeIdentity` (spec: "Duplicate provisioning does not create a second identity")
- [x] 4.3 Fail-closed if `workspace_buckets` returns no bucket for the workspace (Design D3): throw `STORAGE_BOUNDARY_BUCKET_NOT_FOUND` before calling the IAM client

> **RE-SCOPED & RESOLVED (sections 5, 6, 7) — operator chose "implement at runtime".**
> The original tasks assumed `rotateStorageProgrammaticCredential`, `rotateTenantStorageContextCredential`,
> and `revokeStorageProgrammaticCredential` were impure, backend-calling functions. They are **pure,
> synchronous, deterministic builders** in the `services/adapters/src` "preview" layer (locked by the
> contract/unit/adapter/blackbox suites); making them async + network-calling would break that suite.
> Resolution: keep the pure builders pure and **compose** them with the §2 IAM client in a new runtime
> executor module — `services/provisioning-orchestrator/src/actions/storage-identity-runtime.mjs`
> (`rotateStorageCredentialIdentity`, `cleanupRotatedCredentialIdentity`, `revokeStorageCredentialIdentity`,
> `cascadeRevokeWorkspaceIdentities`, `syncStorageIdentityActions`) — plus the expiry-sweep action for
> policy rotations. Covered by `tests/unit/storage-identity-runtime.test.mjs`,
> `tests/unit/storage-credential-expiry-sweep-iam.test.mjs`, and blackbox `bbx-swfs-id-9.2-full`/`9.3-full`.

## 5. Wire rotation

- [x] 5.1 Implemented at the runtime layer: `rotateStorageCredentialIdentity` composes the pure `rotateStorageProgrammaticCredential` (secretVersion+1) with `writeIdentity`, carrying BOTH the new and previous credential entries (grace-window overlap, Design D4). The pure builder is unchanged
- [x] 5.2 `rotateTenantStorageContextCredential` is N/A for identity sync — the tenant storage *context* credential is the provider connection secret (`secretRef` in vault), not a per-workspace S3 identity, so there is no SeaweedFS identity to write at context level. Documented; pure builder left unchanged
- [x] 5.3 Expiry sweep (`storage-credential-expiry-sweep.mjs`) now writes the rotated SeaweedFS identity (grace overlap) for `rotationReason: "policy_expiry"` when a `writeIdentityFn` is wired — opt-in so deployments without SeaweedFS are unaffected
- [x] 5.4 Grace-window cleanup: `cleanupRotatedCredentialIdentity` (runtime module) + `cleanupGraceExpiredIdentities` (sweep) rewrite the identity to keep only the current credential after the overlap window, so the previous key is rejected

## 6. Wire revocation

- [x] 6.1 `revokeStorageCredentialIdentity` (runtime module) composes the pure `revokeStorageProgrammaticCredential` with `deleteIdentity` + reload so the revoked key is immediately rejected
- [x] 6.2 `cascadeRevokeWorkspaceIdentities` (runtime module) enumerates + deletes every workspace identity for a tenant/workspace deletion. NOTE: the existing `cascadesCredentialRevocation` field on `buildTenantStorageContextRecord` is a pure status flag; the deletion executor is what the lifecycle runtime invokes

## 7. Policy-update sync

- [x] 7.1 `syncStorageIdentityActions` (runtime module) + `updateIdentityActions` (IAM client) re-scope an identity's `actions` in place (preserving credentials) so a policy downgrade removes `Write` immediately without a key rotation. NOTE: invoked by the runtime that owns the workspace policy/identity (decisions are evaluated in-process per request — there is no persisted decision to hook)

## 8. Back-fill script

- [x] 8.1 Write a one-time back-fill script (`scripts/backfill-seaweedfs-identities.mjs`) that iterates all active workspace storage credentials lacking a SeaweedFS identity and calls `provisionWorkspaceStorageBoundary` for each; skip re-delivery of secret (masked key only); log workspace IDs that need a manual rotate to get a usable key — injectable `runBackfill`; `tests/unit/backfill-seaweedfs-identities.test.mjs`
- [x] 8.2 Document in the script header whether to force-rotate existing credentials (resolves Design OQ1 — note both options and default to no-force-rotate pending operator decision) — documented in the script header; `--force-rotate` flag, default off

## 9. Blackbox and adapter tests

- [x] 9.1 Write a blackbox test (`tests/blackbox/seaweedfs-tenant-identities.test.mjs`) that: provisions a workspace, asserts the storage credential record has `accessKeyIdMasked` set and `secretVersion: 1`, and verifies the one-time secret envelope is returned exactly once (idempotent re-provision delivers no new secret)
- [x] 9.2 Rotation blackbox test — `bbx-swfs-id-9.2-full` drives the runtime `rotateStorageCredentialIdentity`: `secretVersion` increments 1→2, grace-overlap keeps the old key valid, then `cleanupRotatedCredentialIdentity` drops it and the old key is rejected
- [x] 9.3 Revocation blackbox test — `bbx-swfs-id-9.3-full` drives the runtime `revokeStorageCredentialIdentity`: record marked revoked and the key is rejected by SeaweedFS
- [x] 9.4 Cross-tenant probe blackbox test (two-tenant fixture): Tenant A's access key attempting `GetObject`/`ListObjectsV2` on Tenant B's bucket returns `AccessDenied` from identity/bucket scoping (`bbx-swfs-id-9.4`)
- [x] 9.5 Ensure all test fixtures use non-provider prefixes (`TEST_AK_…`, not `AKST`/`sk_live_`) to avoid GitHub push-protection rejections — runtime-derived keys are not committed; committed literals use `TEST_AK_`

## 10. Real-stack proof in tests/env

> **RESOLVED (OQ2).** The real SeaweedFS 4.33 admin path is `weed shell s3.configure -apply` (verified
> against the pinned image: per-bucket-scoped action strings, credential append for grace overlap,
> `-delete` removal). Implemented as `createWeedShellTransport({ exec })` in the IAM client (exec wraps
> `weed shell` over `kubectl exec`/`docker exec`; static identities protected). Real-stack slice
> `tests/env/seaweedfs/seaweedfs-tenant-identities.test.mjs` + kind runner
> `tests/env/seaweedfs/run-tenant-identities.sh` (ephemeral namespace, port-forward, always torn down;
> self-skips without a cluster). **Ran green on the kind test cluster** (1 pass, ~7s).

- [x] 10.1 Real-stack slice exercises the full provision → rotate (grace) → cleanup → revoke lifecycle against a LIVE SeaweedFS (kind, ephemeral ns) — `tests/env/seaweedfs/run-tenant-identities.sh`
- [x] 10.2 Cross-tenant isolation probe in the slice: Tenant A's key gets `AccessDenied` (403) on Tenant B's bucket from the live gateway (and the rotated key stays cross-tenant denied)
- [x] 10.3 No plaintext secret in the persisted credential record (masked key + `secretVersion` only); the secret is delivered once via the envelope — asserted in the slice

## 11. Validation

- [x] 11.1 Run `openspec validate add-seaweedfs-tenant-identities --strict` and fix until clean — valid
- [x] 11.2 Run `bash tests/blackbox/run.sh` — all new tests green, no regressions (549 pass / 0 fail; also `tests/adapters` 131, `tests/contracts` 232, `tests/unit` 656 green)
- [x] 11.3 Run the real-stack `tests/env/` slice — passes against live SeaweedFS on the kind test cluster (`bash tests/env/seaweedfs/run-tenant-identities.sh` → 1 pass; namespace torn down)
