## Why

Falcone today issues only synthetic, SHA-256-derived access keys that are never written to any storage backend: `provisionWorkspaceStorageBoundary` is a `NOT_YET_IMPLEMENTED` stub (`services/adapters/src/storage-tenant-context.mjs:465-469`) and both real runtimes share a single root credential for all tenants (`deploy/kind/control-plane/storage-handlers.mjs:13-14`). As a result, per-tenant key rotation/revocation has no effect on the backend, and cross-tenant access is not enforced at the S3 layer — any tenant that discovers or guesses another tenant's bucket name can access it. Delivering real per-tenant SeaweedFS identities (via the S3 `identities` model / `s3.configure` IAM API) closes this isolation gap and makes the existing rotation-policy and revocation machinery actually effective.

## What Changes

- Implement `provisionWorkspaceStorageBoundary` in `services/adapters/src/storage-tenant-context.mjs` to call the SeaweedFS IAM API and create a real S3 identity scoped to the tenant's bucket(s); persist `accessKeyIdMasked` + `secretVersion`; deliver the secret once through `buildStorageProgrammaticCredentialSecretEnvelope`.
- Wire rotation: `rotateStorageProgrammaticCredential` and `rotateTenantStorageContextCredential` write the new key to SeaweedFS via `s3.configure` and trigger an identity reload; the expiry-sweep (`storage-credential-expiry-sweep.mjs`) honour the rotation-policy row (migration `090-storage-credential-rotation-policy.sql`).
- Wire revocation: `revokeStorageProgrammaticCredential` and the lifecycle `cascadesCredentialRevocation` path delete the SeaweedFS identity and trigger a reload so the old key stops working immediately.
- Map `services/adapters/src/storage-access-policy.mjs` decisions onto SeaweedFS identity `actions`/`buckets` fields so each tenant key is scoped to its own bucket(s)/prefix; cross-tenant access is denied by SeaweedFS, not just in-process.
- Add a SeaweedFS IAM client module (thin wrapper around `s3.configure` HTTP call + reload trigger); no SDK dependency.
- Blackbox + adapter tests updated; real-stack proof in `tests/env/`; no plaintext secret persisted; push-protection-safe fixtures.

## Capabilities

### New Capabilities

_(none — this change implements existing capability stubs rather than introducing a new top-level capability)_

### Modified Capabilities

- `storage`: ADDED requirements — real per-tenant SeaweedFS identity provisioning on workspace storage activation; real rotation (sweep-triggered and manual) writes/reloads the identity; explicit and cascade revocation removes the identity; per-bucket action scoping derived from the in-process access-policy engine.
- `tenant-isolation`: ADDED requirement — per-tenant storage credentials enforce cross-tenant denial at the SeaweedFS S3 layer (not only in application code); cross-tenant rejection scenario with Tenant A's key refused for Tenant B's bucket.

## Impact

- **Code**: `services/adapters/src/storage-tenant-context.mjs` (stub replacement), `services/adapters/src/storage-programmatic-credentials.mjs` (rotation/revocation wiring), `services/adapters/src/storage-access-policy.mjs` (policy serialisation), new `services/adapters/src/seaweedfs-iam-client.mjs`.
- **APIs**: No new public routes; existing provision/rotate/revoke routes now have real backend effect.
- **Dependencies**: DEPENDS ON `add-seaweedfs-storage-adr-spike` (identities write/reload prototype), `add-seaweedfs-deployment` (running SeaweedFS instance), `add-seaweedfs-bucket-lifecycle-migration` (bucket-per-workspace mapping in `workspace_buckets`).
- **Security**: Security-critical — closes cross-tenant S3 isolation gap; no plaintext secrets persisted; push-protection-safe test fixtures required.
- **Schema**: Uses existing `090-storage-credential-rotation-policy.sql` migration; no new migrations.
