## Context

Falcone's storage capability is built on a provider abstraction with three registered providers: `minio` (default, hardcoded at `services/adapters/src/storage-provider-profile.mjs:33`), `ceph-rgw`, and `garage`. The registry key `SUPPORTED_STORAGE_PROVIDER_TYPES` is derived from `Object.keys(STORAGE_PROVIDER_DEFINITIONS)` at `:400-401`, so adding a provider requires only inserting a new entry into that map. The live runtime in `deploy/kind/control-plane/storage-handlers.mjs` communicates with the S3-compatible backend via hand-rolled AWS Signature V4 (no SDK), reading endpoint/credentials exclusively from `MINIO_*` env vars (`:12-15`). The `openapi-sdk-service` is already provider-neutral — it uses `S3_ENDPOINT` and `forcePathStyle: true` (`services/openapi-sdk-service/src/sdk-storage.mjs:8-10`).

SeaweedFS exposes a S3-compatible gateway on port 8333 (path-style). Its compatibility matrix (per adr-spike) shows all baseline operations satisfied, versioning partially satisfied (requires explicit bucket flag), and lifecycle/object-lock/event-notifications unsatisfied.

## Goals / Non-Goals

**Goals:**

- `resolveStorageProviderConfig('seaweedfs')` returns a valid, baseline-eligible profile.
- Provider introspection (`GET /v1/platform/storage/provider`) accurately reports SeaweedFS capabilities.
- Live runtime endpoint config is provider-neutral; switching to SeaweedFS requires only chart env changes.
- Default provider is config-driven via `STORAGE_DEFAULT_PROVIDER_TYPE`.
- No hardcoded `providerType: 'minio'` literal remains on live paths.
- List XML parsing is robust enough for SeaweedFS response envelopes.
- All existing contract/unit/adapter tests remain green; new tests cover the SeaweedFS profile.

**Non-Goals:**

- Deploying SeaweedFS into any environment (tracked separately as `add-seaweedfs-deployment`).
- Integrating SeaweedFS with the identities/credential management service.
- Adding new tenant-facing storage routes.
- Supporting SeaweedFS-specific features not covered by the S3-compatible interface (e.g., filer API, erasure coding config).

## Decisions

**Decision 1: Insert `seaweedfs` into `STORAGE_PROVIDER_DEFINITIONS` using the existing `buildProviderDefinition` factory.**

The factory already handles capability-entry derivation, boolean manifest computation, and baseline validation. Inserting a new key in the existing map is the minimal, correct extension point — it automatically updates `SUPPORTED_STORAGE_PROVIDER_TYPES`, `resolveStorageProviderConfig`, and the introspection surface with no structural change.

Alternatives considered: a separate registry file. Rejected — premature abstraction; the existing in-module map is the established pattern for `ceph-rgw` and `garage`.

**Decision 2: Env-var aliasing for provider-neutral endpoint names with backward-compatible fallback.**

Rename the logical env var to `STORAGE_S3_ENDPOINT` / `STORAGE_S3_ACCESS_KEY` / `STORAGE_S3_SECRET_KEY` in `storage-handlers.mjs`, reading `MINIO_*` as fallback: `process.env.STORAGE_S3_ENDPOINT || process.env.MINIO_ENDPOINT`. This avoids breaking existing kind/openshift deployments while enabling SeaweedFS wiring via chart values alone.

Alternatives considered: rename only at the chart level (keep `MINIO_*` in code). Rejected — the code comments and variable names remain misleading and the assumption propagates.

**Decision 3: Config-driven `DEFAULT_STORAGE_PROVIDER_TYPE` via `STORAGE_DEFAULT_PROVIDER_TYPE` env var.**

Read `process.env.STORAGE_DEFAULT_PROVIDER_TYPE` at module init; fall back to `'minio'` when absent. This is a single-line change in `storage-provider-profile.mjs` that gives operators full control without touching source.

Alternatives considered: a chart-level default that injects `providerType` into every tenant context. Rejected — too invasive; the env-var pattern is consistent with how other Falcone defaults work.

**Decision 4: Replace hardcoded `providerType: 'minio'` in `storage-multipart-presigned.mjs:443` with the value from the supplied tenant storage context.**

The fixture already receives `tenantStorageContext` at call sites; the literal is an oversight. Reading `tenantStorageContext.providerType` (with fallback to `DEFAULT_STORAGE_PROVIDER_TYPE`) is correct and tests the real code path.

**Decision 5: Replace bare regex XML parsing in `storage-handlers.mjs:76-97` with a DOMParser-less but entity-aware helper.**

The current `allTags`/`oneTag` helpers use simple regex and are fragile against CDATA and entity-encoded content. The replacement SHALL use a whitelist-decode for `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#34;` and strip CDATA wrappers before extracting tag content — no external dependency, keeps the file self-contained.

Alternatives considered: pull in an XML parser dependency (`fast-xml-parser`). Rejected — adds a dependency to a minimal runtime file; the bounded S3 response schema makes a targeted decoder sufficient.

**Decision 6: `seaweedfs` providerCodeByType entries inherit S3 standard codes.**

SeaweedFS uses standard S3 XML error codes (`NoSuchKey`, `NoSuchBucket`, `BucketAlreadyExists`, `AccessDenied`, `InvalidBucketName`) — same as the other three providers. Each `providerCodeByType` map gets a `seaweedfs` key set to the same value as the `default` key.

## Risks / Trade-offs

- [Risk: SeaweedFS versioning behavior diverges from `partially_satisfied` assumption] → Mitigation: the capability entry carries a constraint `{ key: 'versioningMode', value: 'bucket_flag_required' }` and the limitation code `OBJECT_VERSIONING_BUCKET_FLAG_REQUIRED`; the lifecycle-migration change can re-evaluate.
- [Risk: XML parsing hardening misses an edge-case SeaweedFS envelope] → Mitigation: adapter tests in `tests/adapters/` include fixture XML captured from a real SeaweedFS 3.x gateway; a unit test covers entity-encoded key names and CDATA-wrapped values.
- [Risk: Backward-compat env alias causes confusion] → Mitigation: `storage-handlers.mjs` logs a single deprecation-style `console.warn` at startup when `MINIO_ENDPOINT` is used and `STORAGE_S3_ENDPOINT` is absent; chart values for existing deployments remain unchanged.
- [Risk: `tests/blackbox/run.sh` still targets a MinIO-backed env] → Mitigation: the contract test changes are additive; existing MinIO-backed CI runs remain green; SeaweedFS-backed runs are validated in `tests/env/` real-stack slice.

## Migration Plan

1. Merge this change (provider registration + env aliasing + hardening).
2. Simultaneously or after: merge `add-seaweedfs-deployment` (deploys SeaweedFS into kind/openshift; sets `STORAGE_S3_ENDPOINT` pointing at port 8333 and `STORAGE_DEFAULT_PROVIDER_TYPE=seaweedfs`).
3. Run `bash tests/blackbox/run.sh` (contract unchanged); run `tests/env/` real-stack slice against SeaweedFS.
4. Rollback: revert chart values to `MINIO_ENDPOINT` + remove `STORAGE_DEFAULT_PROVIDER_TYPE`; the code fallback keeps MinIO operational without redeploy.

## Open Questions

- Exact SeaweedFS S3 gateway error code for `BucketAlreadyOwnedByYou` vs `BucketAlreadyExists` — to be confirmed against adr-spike findings before implementing the verification module update.
- Whether SeaweedFS partial versioning should surface as `partially_satisfied` or `unsatisfied` in the boolean manifest — currently treated as `unsatisfied` in `deriveBooleanManifestFromEntries` (only `satisfied` maps to `true`); acceptable for now.
