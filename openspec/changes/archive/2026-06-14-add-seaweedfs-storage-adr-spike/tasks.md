## 1. Pin SeaweedFS version and stand up spike environment

- [x] 1.1 Identify the latest stable SeaweedFS minor release and record the exact image tag (e.g., `chrislusf/seaweedfs:3.x.y`) as the version pin for ADR-13 Evidence
- [x] 1.2 Start a SeaweedFS master + volume server + S3 gateway using Docker at the pinned version; confirm the S3 gateway port (record actual port, expected 8333)
- [x] 1.3 Start a SeaweedFS filer configured with a `filer.toml` `[postgres2]` section pointing at a Falcone-compatible Postgres 14+ instance; confirm the filer connects and the schema is applied without error

## 2. Filer-on-PostgreSQL smoke test

- [x] 2.1 Create a bucket via the SeaweedFS filer
- [x] 2.2 Write an object to that bucket and read it back; confirm round-trip content integrity
- [x] 2.3 Delete the object and the bucket; confirm the filer metadata in PostgreSQL is cleaned up
- [x] 2.4 Record the PostgreSQL DDL applied by SeaweedFS (tables, extensions required) and assess compatibility with Falcone's existing migration conventions
- [x] 2.5 If any step fails, record the exact error, the Postgres version and extension state, and a fallback recommendation (embedded LevelDB filer or alternative)

## 3. S3 path-style and presigned-GET validation

- [x] 3.1 Issue a path-style S3 request (`http://host:8333/bucket/key`) and confirm it succeeds (validates `forcePathStyle: true` as used in `services/openapi-sdk-service/src/sdk-storage.mjs`)
- [x] 3.2 Generate a SigV4 presigned GET URL for a test object and confirm the URL is accepted by the SeaweedFS S3 gateway; record `region` value required (vs. `auto` used in sdk-storage.mjs and `us-east-1` used in `deploy/kind/control-plane/storage-handlers.mjs`)

## 4. ListBuckets and ListObjectsV2 XML envelope validation

- [x] 4.1 Collect the raw ListBuckets XML response from SeaweedFS S3 gateway
- [x] 4.2 Collect the raw ListObjectsV2 XML response for a non-empty bucket
- [x] 4.3 Run the actual regex patterns from `deploy/kind/control-plane/storage-handlers.mjs:76-97` against both responses; record MATCH or MISMATCH with the exact element that diverges
- [x] 4.4 Classify ListBuckets and ListObjectsV2 in the compatibility matrix (SUPPORTED / PARTIAL / UNSUPPORTED) with HTTP status and XML evidence

## 5. Bucket-management API compatibility matrix

- [x] 5.1 Call `putBucketPolicy` with a minimal policy document; record HTTP status and response body; classify SUPPORTED / PARTIAL / UNSUPPORTED
- [x] 5.2 Call `getBucketPolicy` immediately after; confirm the policy round-trips correctly; classify
- [x] 5.3 Call `putBucketVersioning` with `Status: Enabled`; record HTTP status; classify
- [x] 5.4 Call `putBucketLifecycleConfiguration` with a minimal expiration rule; record HTTP status and any XML schema deviation; classify
- [x] 5.5 Call `putBucketCors` with a minimal CORS rule; record HTTP status; classify
- [x] 5.6 Test object versioning by writing two versions of the same key and retrieving by version ID; classify
- [x] 5.7 Attempt to enable object-lock / WORM on a bucket; record HTTP status; classify

## 6. Gap recommendations

- [x] 6.1 For every PARTIAL or UNSUPPORTED entry in the matrix, assign a use / shim / drop recommendation with a one-sentence rationale
- [x] 6.2 Specifically recommend how to handle the regex XML parser in `deploy/kind/control-plane/storage-handlers.mjs:76-97` if ListBuckets or ListObjectsV2 are classified as PARTIAL or UNSUPPORTED

## 7. Per-tenant identities write/reload prototype

- [x] 7.1 Write a SeaweedFS S3 `identities` static JSON file containing one tenant entry (accessKey, secretKey, actions, buckets) and start the gateway; confirm S3 requests signed with that identity are accepted
- [x] 7.2 Call the `s3.configure` HTTP API to add a second tenant identity without restarting the gateway; confirm the gateway accepts S3 requests for the new identity immediately
- [x] 7.3 Map the identity fields (accessKey, secretKey, actions, buckets) against the parameters constructed by `services/provisioning-orchestrator/src/appliers/storage-applier.mjs`; record any field-mapping gaps or shim requirements
- [x] 7.4 If the `s3.configure` API is unavailable at the pinned version, record the constraint and confirm the SIGHUP + file reload path works as the fallback; note the implication for the provisioning model (restart-required vs. live reload)

## 8. Author ADR-13

- [x] 8.1 Append `## ADR-13 — Migrate object store from MinIO to SeaweedFS` to `docs-site/architecture/adrs.md` with Decision, Why, Evidence, and Risks sections
- [x] 8.2 Decision section: state SeaweedFS (Apache-2.0) is selected; record the pinned version from task 1.1
- [x] 8.3 Why section: MinIO CE console regression (OIDC removed May 2025), flagship repo archived Feb 2026, AGPLv3 licence misfit; SeaweedFS: Apache-2.0, small-object fit, K8s support, filer-on-PG validated
- [x] 8.4 Evidence section: reference the compatibility matrix (task 5), filer-on-PG smoke test (task 2), port confirmation (task 1.2), identities prototype (task 7)
- [x] 8.5 Risks section: version divergence (downstream changes pinned to spike version), filer-on-PG schema coupling, regex XML parser incompatibility (gap recommendation from task 6)
- [x] 8.6 Rejected alternatives section: MinIO CE (licence + console), RustFS (alpha), Ceph/Rook (operational weight) — each with one-sentence rejection rationale

## 9. Validate and finalize

- [x] 9.1 Run `openspec validate add-seaweedfs-storage-adr-spike --strict` and confirm it passes; fix any residual issues
- [x] 9.2 Confirm the compatibility matrix, filer-on-PG findings, port, and identities prototype are referenced by or attached to this change so downstream changes can consume them
