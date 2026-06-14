## Context

Falcone exposes object storage to tenants through three unrelated S3 code paths:

- `services/openapi-sdk-service/src/sdk-storage.mjs` — AWS SDK v3, presigned GET,
  `forcePathStyle: true`, `region: 'auto'`
- `deploy/kind/control-plane/storage-handlers.mjs:76-97` — hand-rolled SigV4 over
  fetch, path-style, `region: us-east-1`, fragile regex XML parsing
- `services/provisioning-orchestrator/src/appliers/storage-applier.mjs` — AWS SDK
  v2-style injected client executing putBucketPolicy / putBucketVersioning /
  putBucketLifecycleConfiguration / putBucketCors (currently test-injected, unwired
  in production)

The provider registry (`services/adapters/src/storage-provider-profile.mjs`) lists
`minio`, `ceph-rgw`, and `garage` but has no `seaweedfs` entry.

S3 compatibility in SeaweedFS is version-dependent and not fully documented; the
filer metadata backend choice (embedded vs. PostgreSQL) affects operational coupling
with Falcone's existing database tier. Neither has been validated against Falcone's
actual usage patterns.

## Goals / Non-Goals

**Goals:**

- Produce ADR-13 in the established format so the decision is on record.
- Run a version-pinned compatibility spike against a real SeaweedFS instance covering
  every S3 operation Falcone currently uses or plans to use.
- Validate filer-on-PostgreSQL as a metadata backend (reduces operational surface by
  reusing Falcone's existing Postgres).
- Confirm the S3 gateway port and prototype the per-tenant `identities` write/reload
  cycle so the credential-injection model is de-risked before implementation.
- Produce a use / shim / drop recommendation for every compatibility gap to feed
  downstream changes.

**Non-Goals:**

- Modifying any source code, Helm charts, or tests in this change.
- Implementing SeaweedFS provider registration, credential integration, or deployment
  manifests (those are separate follow-on changes that consume this spike's output).
- Evaluating SeaweedFS for non-S3 use cases (e.g., POSIX filer, raw volume).

## Decisions

### D1 — Run the spike against a Docker-based SeaweedFS instance at a pinned version

**Rationale**: A pinned version is the only way to produce a reproducible compatibility
matrix. Docker (`chrislusf/seaweedfs:<version>`) provides a controlled environment
without requiring cluster changes. The version pin is the primary deliverable anchor —
all downstream changes are written against that pin.

**Alternatives considered**: Running against the kind test-cluster (harder to pin and
tear down cleanly); evaluating against SeaweedFS HEAD (moving target, not reproducible).

### D2 — Use filer-on-PostgreSQL with Falcone's existing Postgres schema conventions

**Rationale**: Falcone already operates Postgres as its primary datastore. Reusing it
for SeaweedFS filer metadata avoids introducing a new stateful dependency. The spike
validates that SeaweedFS's `filer.toml` `[postgres2]` section works against a
standard Postgres 14+ instance. If it fails, the spike records the exact error and the
fallback is SeaweedFS's embedded LevelDB filer (which the deployment change would then
use instead).

**Alternatives considered**: Embedded LevelDB (no external dep but not HA-capable);
CockroachDB (not in Falcone's current stack).

### D3 — Validate identities via both static file and s3.configure API

**Rationale**: SeaweedFS supports two mechanisms: a static `s3.json` identities file
(loaded at start or on SIGHUP) and the `s3.configure` HTTP API (live reload). Falcone's
provisioning-orchestrator needs live reload semantics (tenant onboarded without restart),
so the spike must confirm that the API path works. The static path is also tested as a
fallback baseline.

### D4 — Score every operation SUPPORTED / PARTIAL / UNSUPPORTED with HTTP evidence

**Rationale**: Binary yes/no is insufficient — PARTIAL captures cases where the call
succeeds but the response deviates from spec in ways that break Falcone's consumers
(e.g., XML field names differing from what the regex parser in storage-handlers.mjs
expects). HTTP status + response body excerpts are recorded as evidence so the matrix
is auditable.

## Risks / Trade-offs

- **SeaweedFS version divergence** → Downstream changes are coded to the pinned version;
  upgrade paths must re-run the relevant matrix cells. Mitigation: record the version
  prominently in the spike output and in ADR-13's Evidence section.

- **Filer-on-PG schema conflicts** → SeaweedFS may require schema extensions or tables
  that conflict with Falcone's migrations. Mitigation: run against a dedicated PG
  database/schema, document the DDL SeaweedFS applies, and assess conflict risk.

- **Regex XML parser incompatibility** → The hand-rolled parser in
  `storage-handlers.mjs:76-97` may break on SeaweedFS's XML responses. Mitigation:
  the spike captures raw responses; if incompatible, the gap recommendation will be
  "shim" (replace regex with a proper XML parser) and that work lands in the
  deployment change.

- **s3.configure API stability** → The API is undocumented in older SeaweedFS versions.
  Mitigation: test at the pinned version; if unavailable, fall back to SIGHUP + file
  and record as a constraint on the provisioning model.

## Open Questions

1. Which specific SeaweedFS version should be pinned? Candidate: latest stable minor
   release at spike execution time (record in ADR-13 Evidence).
2. Does SeaweedFS's `putBucketLifecycleConfiguration` support the same XML schema as
   AWS S3, or only a subset? (Answered by spike.)
3. Can the filer PostgreSQL backend share a database with Falcone's application tables,
   or does it require a dedicated database? (Answered by smoke test.)
