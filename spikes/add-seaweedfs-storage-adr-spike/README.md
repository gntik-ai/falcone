# SeaweedFS storage ADR spike

De-risks the MinIO → SeaweedFS object-storage migration (epic #430) and backs **ADR-13**.
OpenSpec change: `add-seaweedfs-storage-adr-spike` (GitHub #431).

**Pinned target:** SeaweedFS `4.33` —
`chrislusf/seaweedfs@sha256:f0b358973e81f884304737645dd3b278c590c2c9d47d60089729d46324f70495`.

## What it proves
- S3 gateway port **8333**; path-style + SigV4 presigned GET work; region scope ignored.
- The live runtime's regex XML parser (`deploy/kind/control-plane/storage-handlers.mjs:76-97`) is
  byte-compatible with SeaweedFS `ListBuckets` / `ListObjectsV2`.
- Bucket management (versioning, lifecycle, CORS, object-lock, object versioning) is SUPPORTED;
  only `putBucketPolicy` is PARTIAL (Principal-shape shim — gap G1).
- **Filer-on-PostgreSQL** is viable (postgres2, one table per bucket, no exotic extensions) with one
  required config: an explicit `createTable` template.
- **Per-tenant identities** can be added live via `s3.configure -apply` with **no gateway restart**;
  per-bucket `actions` enforce tenant isolation.

→ See `compatibility-matrix.md` and `findings.md` for the full results and downstream recommendations.

## Layout
```
docker-compose.yml         # postgres:16 + seaweedfs 4.33 (S3 8333 only host-exposed)
conf/filer.toml            # [postgres2] filer config (incl. required createTable)
conf/s3-identities.json    # bootstrap identities (admin + scoped tenant-a) — SPIKE-ONLY fake creds
probes/matrix.py           # boto3 bucket-management matrix
probes/xml-shape.py        # raw ListBuckets/ListObjectsV2 XML + storage-handlers.mjs regex replay
compatibility-matrix.md    # DELIVERABLE: version-pinned SUPPORTED/PARTIAL/UNSUPPORTED + gap recs
findings.md                # DELIVERABLE: filer-on-PG, port, identities, field-mapping
evidence/                  # raw captured outputs (00..10)
```

## Run
```bash
docker compose up -d                                   # waits on postgres healthcheck
python3 probes/matrix.py                               # bucket-management matrix
python3 probes/xml-shape.py                            # XML envelope + regex replay
docker exec seaweedfs-adr-spike-seaweedfs-1 \
  sh -c 'echo "s3.configure" | weed shell -master localhost:9333'   # identities view
docker compose down -v                                 # teardown (removes volumes)
```
Requires Docker + Python `boto3`. Only host port `127.0.0.1:8333` is published.

## Evidence index
| file | task | content |
|---|---|---|
| `evidence/00-version-pin.txt` | 1.1 | version + image digest |
| `evidence/01-postgres2-default-createtable-failure.txt` | 2.5 | boot crash without `createTable` |
| `evidence/02-s3-gateway-startup-port.txt` | 1.2 | port 8333, Iceberg 8181, STS warning |
| `evidence/03-listbuckets.xml` / `04-listobjectsv2.xml` | 4.1/4.2 | raw S3 list XML |
| `evidence/04b-regex-parser-result.txt` | 4.3 | regex replay MATCH |
| `evidence/04c-pagination-truncation.txt` | 4.3 | `NextContinuationToken` path |
| `evidence/05-bucket-management-matrix.json` | 5.x | machine-readable matrix |
| `evidence/06-bucket-policy-principal-shape.txt` | 5.1/6.1 | policy Principal constraint |
| `evidence/07-pathstyle-presigned.txt` | 3.1/3.2 | path-style + presigned GET, region |
| `evidence/08-postgres-filer-ddl.txt` | 2.4 | filer DDL + per-bucket tables |
| `evidence/09-delete-cleanup.txt` | 2.3 | delete + metadata cleanup |
| `evidence/10-identities-live-reload.txt` | 7.2 | live tenant add, no restart, isolation |
