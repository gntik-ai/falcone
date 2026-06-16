# Capability #5 — Storage / Object Store (SeaweedFS S3) — live-stack evidence

Target: kind `test-cluster-b`, ns `falcone`, Helm `in-falcone-0.3.0`.
Backend: **SeaweedFS S3 gateway** `falcone-seaweedfs-s3:8333` (port-forward `127.0.0.1:18333`).
Control-plane image `in-falcone-control-plane:0.6.2` (hand-built kind runtime under `deploy/kind/control-plane/`).
Date: 2026-06-16. Fixtures: Tenant A = Ops Demo (`$TA_*`), Tenant B = DataPlane Demo (`$TB_*`).

## Architecture (code + runtime verified)

- Storage REST is **NOT** served by the executor's local route table. The executor
  (`falcone-cp-executor`, `CONTROL_PLANE_UPSTREAM=http://falcone-control-plane:8080`) **proxies**
  every `/v1/storage/...` request to the control-plane. There is no `storageExecutor` in the
  executor server composition (`apps/control-plane/src/runtime/main.mjs`).
- The control-plane wires only **5** storage routes (`deploy/kind/control-plane/routes.mjs:119-123`),
  bound to handlers in `deploy/kind/control-plane/storage-handlers.mjs`. It talks to SeaweedFS over
  the S3 REST API with hand-rolled SigV4 (`node:crypto`, no SDK).
- The control-plane reads S3 endpoint/creds from **legacy `MINIO_*` env** that actually point at SeaweedFS:
  `MINIO_ENDPOINT=http://falcone-seaweedfs-s3:8333`, `MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY` ←
  secret `in-falcone-seaweedfs-s3-creds` (keys `s3AccessKey`/`s3SecretKey`). **One single shared
  credential** for the whole platform.
- Auth: storage routes are `auth:'authenticated'` (`gatewayAuthMode: bearer_oidc`). The CP's
  `authenticate()` (`server.mjs`) accepts **Bearer JWT only**; it derives `tenantId`/`workspaceId`
  from verified JWT claims and **strips client-supplied `x-tenant-id`/`x-workspace-id`** before
  dispatch (anti-spoof). ApiKey and trust-header paths get `401 UNAUTHENTICATED`.

### Wired routes (control-plane local handlers)
| Method | Path | Handler | Status |
|---|---|---|---|
| GET  | `/v1/storage/buckets` | storageListBuckets | **Active** |
| POST | `/v1/storage/workspaces/{workspaceId}/buckets` | storageProvisionBucket | **Active** |
| GET  | `/v1/storage/workspaces/{workspaceId}/usage` | storageWorkspaceUsage | **Active** |
| GET  | `/v1/storage/buckets/{bucketId}/objects` | storageListObjects | **Active** |
| GET  | `/v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata` | storageObjectMetadata | **Active** |

### Catalog routes that are NOT wired (NO_ROUTE on the live CP)
From `services/internal-contracts/src/public-route-catalog.json` (25 storage-family routes, intended surface).
All probed live with sa_token + workspace ctx → `404 NO_ROUTE` (or no handler):
- `PUT /v1/storage/buckets/{resourceId}/objects/{objectKey}` (**uploadStorageObject**) — **NOT-DEPLOYED**
- `GET /v1/storage/buckets/{resourceId}/objects/{objectKey}` (**downloadStorageObject**) — **NOT-DEPLOYED**
- `DELETE /v1/storage/buckets/{resourceId}/objects/{objectKey}` (deleteStorageObject) — NOT-DEPLOYED
- `POST /v1/storage/buckets` (createStorage, no-workspace variant) — NOT-DEPLOYED (use the `workspaces/{ws}` variant)
- `DELETE /v1/storage/buckets/{resourceId}` (deleteStorage) / `GET /v1/storage/buckets/{resourceId}` (getStorage) — NOT-DEPLOYED
- `GET/PUT /v1/storage/credentials/rotation-policy`, `GET /v1/storage/tenants/{tenantId}/usage`,
  `GET /v1/storage/audit/coverage`, `GET /v1/platform/storage/provider`, `GET /v1/storage/usage/tenants`,
  `.../workspaces/{ws}/credentials*` (programmatic per-workspace S3 creds), `.../audit`,
  `.../buckets/{bucketId}/imports|exports`, `/v1/tenants/{tenantId}/storage-context*` — all **NOT-DEPLOYED**.

> Consequence: **there is no API path to upload, download or delete an object.** Object writes/reads
> are only possible by going **directly to SeaweedFS** with the shared S3 credential. The REST surface
> is read-only over object inventory/metadata + bucket provisioning.

## Functionality status (empirical)

### fn: List buckets — **Active**
`GET /v1/storage/buckets` (Bearer) → `200`. Returns ALL buckets in SeaweedFS, annotated with
tenant/workspace from the `workspace_buckets` Postgres map.
```
GET /v1/storage/buckets  ->  {"items":[],"page":{"size":0}}   STATUS 200   (clean cluster)
```

### fn: Provision bucket — **Active**
`POST /v1/storage/workspaces/{workspaceId}/buckets {"name":...}` → `201`. Creates a real SeaweedFS
bucket (DNS-safe name derived/validated `[a-z0-9-]{3,63}`) and inserts a `workspace_buckets` row.
```
POST /v1/storage/workspaces/<wsA>/buckets {"name":"lastor-a-22287"}
 -> 201 {"bucket":{"resourceId":"lastor-a-22287","workspaceId":"<wsA>","tenantId":"<A>","status":"active"},
         "record":{"id":"1c7d387c-...","bucket_name":"lastor-a-22287"}}
POST /v1/storage/workspaces/00000000-...-000/buckets -> 404 WORKSPACE_NOT_FOUND  (validates ws exists)
```
Bucket naming: the **client-supplied `name` is used verbatim** (only DNS-sanitised). The buckets are
flat/global in SeaweedFS — there is **no tenant/workspace prefix** in the bucket name; tenant ownership
exists only in the Postgres `workspace_buckets` map, NOT in the object store itself.

### fn: List objects — **Active** (read-only over real S3)
`GET /v1/storage/buckets/{bucketId}/objects` → `200`. Real `ListObjectsV2` against SeaweedFS.
```
GET /v1/storage/buckets/lastor-a-22287/objects
 -> 200 {"items":[{"objectKey":"a-doc.txt","sizeBytes":29,"etag":"eceeaa79...","storageClass":"STANDARD"}],"page":{"size":1}}
GET .../buckets/<nonexistent>/objects -> 404 STORAGE_LIST_FAILED  "s3 GET /<bkt> -> 404"   (proves real S3 backend)
```

### fn: Object metadata (HEAD) — **Active**
`GET /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata` → `200` (real S3 HEAD).
```
GET .../objects/a-doc.txt/metadata
 -> 200 {"contentType":"text/plain; charset=utf-8","sizeBytes":29,"etag":"eceeaa79..."}
GET .../objects/does-not-exist.txt/metadata -> 404 STORAGE_HEAD_FAILED "s3 HEAD /.../... -> 404"
```

### fn: Workspace storage usage — **Active**
`GET /v1/storage/workspaces/{workspaceId}/usage` → `200`. Aggregates live object sizes per mapped bucket.

### fn: Upload / Download / Delete object via API — **NOT-DEPLOYED**
`PUT|GET|DELETE /v1/storage/buckets/{bucketId}/objects/{key}` → `404 NO_ROUTE`. No object write/read/delete
through the API at all. (Via executor proxy: also `NO_ROUTE`.)

### fn: Programmatic S3 credentials / rotation / import-export / audit / cross-tenant usage — **NOT-DEPLOYED**
All `404 NO_ROUTE`. Notably there is **no per-workspace S3 credential issuance** live — the only S3
credential is the single shared platform key.

## Direct S3 access (bypassing the API) — **works, single shared key sees everything**
`aws --endpoint-url http://127.0.0.1:18333` with `in-falcone-seaweedfs-s3-creds` (key len 20, redacted):
```
aws s3 ls                          -> lists ALL buckets (lastor-a-22287, lastor-b-22287)
aws s3 cp file s3://<A-bkt>/a-doc.txt   -> upload OK
aws s3 cp file s3://<B-bkt>/b-doc.txt   -> upload OK
aws s3 cp s3://<B-bkt>/b-doc.txt -      -> reads "tenant-B-secret-payload ..."  (cross-tenant read)
aws s3 cp s3://<A-bkt>/a-doc.txt -      -> reads "tenant-A-secret-payload ..."
```
The shared key is a SeaweedFS **admin/global** credential: it can list, read, write and delete EVERY
tenant's bucket and object. **No per-tenant scoping at the object-store layer.**

## Cross-tenant isolation probe — **LEAK (both layers)**

### (a) Via REST — no ownership check on any storage handler
The handlers (`storageListBuckets`, `storageListObjects`, `storageObjectMetadata`, `storageWorkspaceUsage`)
**never consult `identity.tenantId`/`workspaceId`** to authorize access to a bucket/workspace. They serve
whatever `{bucketId}`/`{workspaceId}` is in the path/query to any authenticated principal.

Probed with a valid Bearer token (platform superadmin) + Tenant A's context headers, reaching Tenant B's
resources:
```
GET /v1/storage/buckets (ctx=A)            -> 200, returns BOTH A's AND B's buckets (with B's tenantId/workspaceId)
GET /v1/storage/buckets/<B-bkt>/objects    -> 200, lists B's objects
GET /v1/storage/buckets/<B-bkt>/objects/<k>/metadata -> 200, B's object metadata
GET /v1/storage/workspaces/<wsB>/usage (ctx=A) -> 200, B's usage incl. pre-existing bucket "ws-primary-assets"
```
`list-buckets` is the clearest IDOR: every authenticated caller enumerates the **entire platform's**
bucket inventory with each bucket's owning tenant/workspace IDs. `list-objects`/`metadata`/`usage` accept
any bucket/workspace ID with no membership check → full cross-tenant object enumeration and metadata read.

> Note on the trusted-header model: the CP strips client `x-tenant-id`/`x-workspace-id` and re-derives
> identity from JWT claims, so a token cannot *spoof* its tenant. But because the storage handlers do **no
> filtering by the derived identity at all**, a correctly tenant-scoped token (`tenant_id`=B) would still
> read A's bucket inventory/objects/usage — the missing check is the bug, independent of which principal calls.
> (A non-superadmin tenant-scoped JWT could not be minted here: only the `in-falcone-superadmin` secret
> exists; no stored tenant-user credentials. The leak is proven from code + the cross-context responses.)

### (b) Via direct S3 — one shared key = all tenants
Confirmed above: the single `in-falcone-seaweedfs-s3-creds` key reads/writes every tenant's bucket. Any
component (or leaked key) with this credential has unrestricted cross-tenant object access. SeaweedFS is
NOT partitioned per tenant; there are no per-tenant S3 identities/policies live.

## Bugs

- **BUG-STOR-1 (HIGH, tenant-isolation / IDOR):** `GET /v1/storage/buckets` returns **all tenants'**
  buckets (names + owning tenantId/workspaceId) to any authenticated caller. No tenant/workspace filter
  in `storageListBuckets` (`deploy/kind/control-plane/storage-handlers.mjs:139`).
  Repro: `cp GET /v1/storage/buckets <anyToken>` → items include other tenants' buckets.
- **BUG-STOR-2 (HIGH, tenant-isolation / IDOR):** `GET /v1/storage/buckets/{bucketId}/objects`,
  `.../objects/{key}/metadata`, and `GET /v1/storage/workspaces/{workspaceId}/usage` perform **no
  ownership check** of the path bucket/workspace against the caller's identity. Any authenticated caller
  lists/reads-metadata-of another tenant's objects and usage by ID.
  Repro: Tenant-B-context token → `GET /v1/storage/buckets/<TenantA-bucket>/objects` → 200 with A's objects.
- **BUG-STOR-3 (MEDIUM, isolation/blast-radius):** Single shared SeaweedFS admin credential for the whole
  platform (`in-falcone-seaweedfs-s3-creds`); buckets are flat/global with no per-tenant S3 identity or
  bucket policy. One leaked key = full cross-tenant data access. (No per-workspace credential issuance is
  deployed; those routes are NO_ROUTE.)

## Not-deployed (do NOT file as bugs)
Object upload/download/delete via API; bucket get/delete; the no-workspace `POST /v1/storage/buckets`;
programmatic/per-workspace S3 credentials + rotation; credential rotation-policy; storage audit trail +
audit coverage; platform storage-provider introspection; cross-tenant usage listing; tenant storage-context;
import/export. (20 of 25 catalog routes → `NO_ROUTE`.)

## Couldn't fully test (why)
- A non-superadmin, tenant-B-scoped JWT (to demonstrate the leak from a real tenant principal rather than a
  platform superadmin) could not be minted: only `in-falcone-superadmin` credentials exist as a cluster
  secret; tenant realms have no stored test-user password. The cross-tenant gap is nonetheless proven by
  source (handlers ignore identity) + cross-context live responses.
- ApiKey (`exk`) and trust-header (`exh`) paths to storage return `401 UNAUTHENTICATED` — the CP storage
  routes are Bearer-JWT-only, so the data-plane API-key credential path does not cover storage at all.

## Cleanup
All created resources removed: S3 objects + buckets (`s3 rm/rb`), `workspace_buckets` rows
(`DELETE FROM workspace_buckets WHERE bucket_name IN (...)` → DELETE 2). Final `GET /v1/storage/buckets`
→ `items:[]`; `aws s3 ls` → empty.
