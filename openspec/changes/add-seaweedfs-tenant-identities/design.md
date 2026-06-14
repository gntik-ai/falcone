## Context

Falcone's storage layer issues synthetic S3 credentials (`AKST…`/`sk_…`) derived via SHA-256 (`services/adapters/src/storage-programmatic-credentials.mjs:138-144`) that are never written to any backend. The only real S3 calls today go through a single shared root credential (`deploy/kind/control-plane/storage-handlers.mjs:13-14`). `provisionWorkspaceStorageBoundary` (`services/adapters/src/storage-tenant-context.mjs:465-469`) is a `NOT_YET_IMPLEMENTED` stub. The rotation-policy schema (`090-storage-credential-rotation-policy.sql`), the expiry-sweep action (`storage-credential-expiry-sweep.mjs`), and the in-process access-policy engine (`storage-access-policy.mjs`) all exist but have no backend effect.

SeaweedFS uses a static `identities` model: each identity carries `name`, `credentials` (list of `accessKey`/`secretKey` pairs), `actions`, and `buckets`. The `s3.configure` HTTP API allows programmatic write + reload. The bucket-per-workspace mapping is maintained in the `workspace_buckets` Postgres table (wired by the `add-seaweedfs-bucket-lifecycle-migration` dependency).

This design depends on three prerequisite changes: `add-seaweedfs-storage-adr-spike` (prototype for the identities write/reload call), `add-seaweedfs-deployment` (a running SeaweedFS instance), and `add-seaweedfs-bucket-lifecycle-migration` (the `workspace_buckets` table that maps workspace → bucket name).

## Goals / Non-Goals

**Goals:**

- Implement `provisionWorkspaceStorageBoundary` to create a real SeaweedFS S3 identity (one identity per workspace) on workspace storage activation.
- Wire `rotateStorageProgrammaticCredential` / `rotateTenantStorageContextCredential` and the expiry sweep to update the SeaweedFS identity and trigger a reload.
- Wire `revokeStorageProgrammaticCredential` and `cascadesCredentialRevocation` to delete the SeaweedFS identity and trigger a reload.
- Serialise `storage-access-policy.mjs` decisions into the SeaweedFS identity `actions`/`buckets` fields.
- Enforce per-tenant cross-tenant denial at the SeaweedFS S3 layer with a cross-tenant blackbox probe.
- No plaintext secrets persisted; push-protection-safe test fixtures.

**Non-Goals:**

- Deploying or configuring SeaweedFS (covered by `add-seaweedfs-deployment`).
- Building tenant-facing object upload/download routes not already wired.
- Multi-bucket-per-workspace strategies beyond what `workspace_buckets` already tracks.
- Provider/client config UI.

## Decisions

### D1 — One SeaweedFS identity per workspace (not per credential record)

**Decision:** The SeaweedFS identity name is derived from `workspaceId` (e.g., `falcone-ws-{workspaceId}`). Rotation updates the `credentials` list within that identity (adding the new pair, removing the expired pair after the grace window). Revocation deletes the whole identity.

**Rationale:** SeaweedFS's `identities` model naturally maps "one identity = one principal with a bucket scope"; a workspace is the right granularity because `workspace_buckets` already provides the workspace → bucket mapping. Per-credential-record identities would multiply the identity count and complicate grace-window overlap (SeaweedFS supports multiple `credentials` entries on one identity, making overlap trivial).

**Alternatives considered:** Per-tenant (not per-workspace) identity — rejected because it cannot scope to a single workspace bucket; a tenant may have multiple workspaces with different bucket names.

### D2 — New SeaweedFS IAM client module (`seaweedfs-iam-client.mjs`)

**Decision:** Introduce `services/adapters/src/seaweedfs-iam-client.mjs` — a thin wrapper around the SeaweedFS `s3.configure` HTTP POST and the reload trigger (`/s3/configure` with the full identities payload). No SDK dependency; use `node:crypto` for signing (consistent with `deploy/kind/control-plane/storage-handlers.mjs`).

**Rationale:** Keeps the IAM concern isolated and mockable in unit tests. The `add-seaweedfs-storage-adr-spike` change already has a prototype of this call; this module formalises it.

**Alternatives considered:** Inline the `s3.configure` call in `storage-tenant-context.mjs` — rejected, harder to unit-test and duplicates signing logic.

### D3 — Fail-closed on missing bucket mapping

**Decision:** If `workspace_buckets` returns no bucket name for the workspace at provision time, `provisionWorkspaceStorageBoundary` MUST throw rather than writing a wildcard identity. An empty or wildcard `buckets` field in the SeaweedFS identity is explicitly prohibited (see `tenant-isolation` spec scenario "Absent or empty bucket scoping is rejected at identity write time").

**Rationale:** A wildcard identity would grant the workspace key access to every tenant's bucket — a critical isolation failure. Fail-closed is consistent with the RLS fail-closed policy already codified in `openspec/specs/tenant-isolation/spec.md`.

### D4 — Grace-window overlap via multi-credential SeaweedFS identity entry

**Decision:** During rotation, the old credential entry is kept in the identity's `credentials` list until `graceOverlapSeconds` (derived from the rotation policy) elapses. A scheduled cleanup step (same sweep, next run after the grace window) removes the stale entry and triggers a reload.

**Rationale:** SeaweedFS natively supports multiple `credentials` entries per identity; no custom token-level TTL mechanism is needed.

### D5 — Action mapping from `storage-access-policy.mjs`

**Decision:** Map the policy engine's output to SeaweedFS `actions` using a fixed translation table:

| Policy permission | SeaweedFS action |
|---|---|
| `read` | `Read` |
| `write` | `Write` |
| `list` | `List` |
| `admin` | `Admin` |

The bucket field is always the workspace's entry in `workspace_buckets`. The mapping is applied on every provision, rotate, and policy-update event.

**Rationale:** Keeps the SeaweedFS representation in sync with the in-process policy so the two cannot diverge.

## Risks / Trade-offs

- **SeaweedFS reload latency** → The `s3.configure` reload is synchronous in SeaweedFS; if it times out, the key state may be inconsistent. Mitigation: retry with exponential back-off in the IAM client; surface errors as a provisioning failure (not a silent success).
- **Grace-window sweep coupling** → The second sweep run (to remove the stale credential entry) depends on the sweep running again within the grace window. If the sweep is down, the old key stays valid longer than intended. Mitigation: document the operational dependency; this is the same risk as the existing rotation-policy sweep.
- **`workspace_buckets` race at provision time** → If the bucket has not been created yet when `provisionWorkspaceStorageBoundary` is called, the bucket field will be absent. Mitigation: the orchestrator MUST create the bucket (via `add-seaweedfs-bucket-lifecycle-migration`) before calling the storage boundary provision step; the IAM client fail-closes if the bucket lookup returns nothing (Decision D3).
- **Push-protection-safe fixtures** → `AKST…` prefixed test keys look like real AWS keys to GitHub secret scanning. Mitigation: use non-provider prefixes in test fixtures (e.g., `TEST_AK_…`), consistent with the existing push-protection-safe fixture convention in this repo.

## Migration Plan

1. Merge `add-seaweedfs-deployment` and `add-seaweedfs-bucket-lifecycle-migration` first.
2. Deploy `seaweedfs-iam-client.mjs` + updated `storage-tenant-context.mjs`; `provisionWorkspaceStorageBoundary` now issues real calls. Existing workspaces that were provisioned under the stub have no SeaweedFS identity — a one-time back-fill script must be run (see tasks.md).
3. Back-fill: for every existing active workspace with a storage credential, call `provisionWorkspaceStorageBoundary` to create a SeaweedFS identity; the new secret envelope is not re-delivered (masked key only); the workspace owner must rotate to get a usable key.
4. Rotation + revocation wiring is backward-compatible (new code paths; no schema change).
5. Rollback: revert to the stub; SeaweedFS identities written during the window must be cleaned up manually (they are harmless — the application will stop using them).

## Open Questions

- OQ1: Should the back-fill step force-rotate existing credentials so tenants receive a usable secret, or is it acceptable to leave them without a valid S3 key until they manually rotate? (Decision deferred to the operator; tasks.md notes both options.)
- OQ2: Should the IAM client use the SeaweedFS admin root credential or a dedicated admin service account? (Depends on `add-seaweedfs-deployment` configuration; tasks.md gates this step on that dependency.)
