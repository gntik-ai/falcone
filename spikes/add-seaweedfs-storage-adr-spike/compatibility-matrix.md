# SeaweedFS S3-compatibility matrix — version-pinned

**OpenSpec change:** `add-seaweedfs-storage-adr-spike` · **GitHub:** #431 (epic #430)

**SeaweedFS version under test:** `4.33` (build `55010be19`, `linux/amd64`, volume-size-limit build `30GB`)
**Image pin (reproducible):** `chrislusf/seaweedfs@sha256:f0b358973e81f884304737645dd3b278c590c2c9d47d60089729d46324f70495`
**S3 gateway port:** **8333** — confirmed (expected value held). Filer 8888, master 9333, volume 8080, Iceberg REST catalog 8181.
**Addressing / region:** path-style required (`forcePathStyle: true`); the gateway **ignores the credential region scope** — both `auto` and `us-east-1` sign and verify identically.

Every row was produced against the running instance from `docker-compose.yml`; raw evidence is under `evidence/`.

## Matrix

| # | Operation | Falcone caller | Class | HTTP | Evidence | Recommendation |
|---|-----------|----------------|-------|------|----------|----------------|
| 1 | Path-style addressing | `services/openapi-sdk-service/src/sdk-storage.mjs` (`forcePathStyle:true`) | **SUPPORTED** | 200 | `07-pathstyle-presigned.txt` | **use** — no change |
| 2 | SigV4 presigned GET | `sdk-storage.mjs` (`getSignedUrl`) | **SUPPORTED** | 200 | `07-pathstyle-presigned.txt` | **use** — works with `region:auto` and `us-east-1`; region irrelevant |
| 3 | ListBuckets (XML envelope) | `deploy/kind/control-plane/storage-handlers.mjs:76-97` regex parser | **SUPPORTED** | 200 | `03-listbuckets.xml`, `04b-regex-parser-result.txt` | **use** — regex parser MATCHES; no shim |
| 4 | ListObjectsV2 (XML envelope) | `storage-handlers.mjs:76-97` regex parser | **SUPPORTED** | 200 | `04-listobjectsv2.xml`, `04b`, `04c-pagination-truncation.txt` | **use** — regex MATCHES incl. pagination; ETag uses `&#34;` which the parser already strips |
| 5 | createBucket | `storage-applier.mjs` (`createBucket`) | **SUPPORTED** | 200 | `05-bucket-management-matrix.json` | **use** |
| 6 | putObject + getObject (round-trip) | data plane | **SUPPORTED** | 200 | `05-…matrix.json` | **use** — content integrity verified |
| 7 | putBucketPolicy | `storage-applier.mjs` (`putBucketPolicy`) | **PARTIAL** | 400 | `06-bucket-policy-principal-shape.txt` | **shim** — see Gap G1 |
| 8 | getBucketPolicy | `storage-applier.mjs` (`getBucketPolicy`) | **SUPPORTED** | 200 | `06-…policy-shape.txt` | **use** — round-trips for accepted policies |
| 9 | putBucketVersioning (`Status: Enabled`) | `storage-applier.mjs` | **SUPPORTED** | 200 | `05-…matrix.json` | **use** — read-back `Enabled` |
| 10 | putBucketLifecycleConfiguration | `storage-applier.mjs` | **SUPPORTED** | 200 | `05-…matrix.json` | **use** — 1 rule put + read back |
| 11 | putBucketCors | `storage-applier.mjs` | **SUPPORTED** | 200 | `05-…matrix.json` | **use** — 1 rule put + read back |
| 12 | Object versioning (by VersionId) | object.lock capability | **SUPPORTED** | 200 | `05-…matrix.json` | **use** — distinct VersionIds; historical GET returns prior body |
| 13 | Object-lock / WORM | declared `object.lock` capability | **SUPPORTED** | 200 | `05-…matrix.json` | **use** — `ObjectLockEnabledForBucket=True` accepted; config reads back `Enabled` |
| 14 | Per-tenant scoped identity (signs own bucket) | `storage-programmatic-credentials.mjs` + provisioning | **SUPPORTED** | 200 | `05-…matrix.json`, `10-identities-live-reload.txt` | **use** — see findings.md §Identities |
| 15 | Per-tenant isolation (cross-bucket write denied) | tenant-isolation invariant | **SUPPORTED** | 403 | `05-…matrix.json`, `10-…reload.txt` | **use** — `Read:bucket`/`Write:bucket` actions enforce scope; cross-bucket = `AccessDenied` |

**Tally:** 13 SUPPORTED · 1 PARTIAL · 0 UNSUPPORTED.

## Gap recommendations (task 6)

### G1 — `putBucketPolicy` Principal shape — **SHIM**
SeaweedFS 4.33 rejects the AWS-canonical principal forms `"Principal": {"AWS": ["*"]}` and
`{"AWS": "*"}` with `400 MalformedPolicy` (misleading message: *"Policy has invalid resource"*).
It **accepts** the string form `"Principal": "*"`. `getBucketPolicy` then round-trips the stored
document. **Recommendation:** a thin policy-normalization shim in the SeaweedFS provider that flattens
`Principal.AWS` → `"*"` (or to SeaweedFS's supported identity-name form) before `putBucketPolicy`.
Lands in `add-seaweedfs-storage-provider` / `storage-applier` wiring; the spike confirms it is a
shape translation, not a missing capability. Evidence: `06-bucket-policy-principal-shape.txt`.

### G2 — Regex XML parser in `storage-handlers.mjs:76-97` — **USE (no change)**
Both `ListBuckets` and `ListObjectsV2` envelopes are byte-compatible with the hand-rolled regex
parser, including the `&#34;`-encoded ETag quotes (already in the parser's strip set) and the
`NextContinuationToken` pagination path (validated by forcing `IsTruncated=true` at `max-keys=1`).
**Recommendation:** keep the parser as-is for the SeaweedFS migration. (Latent fragility noted in
findings.md, but no migration-blocking change is required.) Evidence: `04b`, `04c`.

## Notes feeding downstream changes
- `add-seaweedfs-deployment`: filer **must** set an explicit `[postgres2] createTable` template (see
  findings.md §Filer-on-PostgreSQL) and the gateway needs an `s3.configure` bootstrap path.
- `add-seaweedfs-tenant-identities` (#433): live per-tenant onboarding via `s3.configure -apply`
  works with **no gateway restart** (findings.md §Identities). The credential field shapes already
  match `storage-programmatic-credentials.mjs`; the **actions** mapping is the net-new shim.
- `add-seaweedfs-bucket-lifecycle-migration`: versioning, lifecycle, CORS, object-lock all SUPPORTED;
  only bucket *policy* needs the G1 shim.
