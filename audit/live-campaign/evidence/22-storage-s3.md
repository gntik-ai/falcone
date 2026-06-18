# Live campaign evidence — 22 · Object storage (cap-storage)

**Scope:** Object-storage REST API (via gateway :9080) + direct S3/SeaweedFS (:18333) + tenant isolation.
**Date:** 2026-06-17/18 · **Stack:** fresh-from-HEAD kind ns `falcone`, test-cluster-b.
**Tenants:** A = acme (`acme-ops`, tenant `78848e21…`, ws `$TA_WS` `928534a8…`); B = globex (`globex-ops`, tenant `fe63fa39…`, ws `$TB_WS` `cc38c85c…`). Both `tenant_owner` JWTs minted via `POST $GW/v1/auth/login-sessions`.

## SeaweedFS vs MinIO — CONFIRMED SeaweedFS, no MinIO
`kubectl -n falcone get pods | grep -iE 'seaweed|minio'`:
```
falcone-seaweedfs-filer-0    1/1 Running
falcone-seaweedfs-master-0   1/1 Running
falcone-seaweedfs-s3-…       1/1 Running
falcone-seaweedfs-volume-0   1/1 Running
```
No MinIO pod. S3 endpoint = SeaweedFS at `falcone-seaweedfs-s3:8333` (port-forward localhost:18333).
NOTE: the kind runtime handler `deploy/kind/control-plane/storage-handlers.mjs` still carries a *stale comment* "MinIO runs as falcone-storage:9000" — the code is S3/SigV4-generic and actually talks to SeaweedFS. Comment only; not a functional issue.

## Deployed route surface (this kind runtime)
Authoritative source: `deploy/kind/control-plane/routes.mjs` (the hand-built kind control-plane runtime serves these locally). The internal-contracts catalog lists ~30 storage routes but **most are NOT deployed here** (404 `NO_ROUTE`). Deployed storage routes (all `auth: authenticated`):
- `GET  /v1/storage/buckets`  → `storageListBuckets`
- `POST /v1/storage/workspaces/{workspaceId}/buckets`  → `storageProvisionBucket`
- `GET  /v1/storage/workspaces/{workspaceId}/usage`  → `storageWorkspaceUsage`
- `GET  /v1/storage/buckets/{bucketId}/objects`  → `storageListObjects`
- `GET  /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata`  → `storageObjectMetadata`
- `PUT/GET/DELETE /v1/storage/buckets/{bucketId}/objects/{objectKey}`  → put/get/delete object

NOT deployed (catalog-only → 404 NO_ROUTE, **NOT bugs**): `POST /v1/storage/buckets`, `GET /v1/storage/buckets/{id}` (bucket detail), `DELETE /v1/storage/buckets/{id}` (bucket delete), `/v1/storage/workspaces/{ws}/credentials*`, `/v1/storage/credentials/rotation-policy`, `/v1/storage/usage/tenants`, `/v1/storage/tenants/{id}/usage`, `/v1/storage/workspaces/{ws}/audit`, exports/imports, `/v1/storage/audit/coverage`, `/v1/platform/storage/provider`, `/v1/tenants/{id}/storage-context`.

## Functionality status

| # | Functionality | Route | Status | Evidence |
|---|---|---|---|---|
| 1 | Provision bucket | `POST /v1/storage/workspaces/$TA_WS/buckets` (acme) | **Working** | 201; `{"bucket":{"resourceId":"lcs32332527493","bucketName":"lcs32332527493","workspaceId":"928534a8…","tenantId":"78848e21…","region":"us-east-1","status":"active"},"record":{…}}` |
| 2 | List buckets | `GET /v1/storage/buckets` (acme-ops) | **Working — tenant-scoped** | acme sees only `lcs32332527493`; globex sees only `lcs3glb17328`. Code: `storageListBuckets` filters `item.tenantId === ctx.identity.tenantId` (non-superadmin). |
| 3a | PUT object | `PUT …/objects/{key}` JSON `{content,contentType}` | **Working** | flat key `greeting.txt` → 201 `sizeBytes:31`; nested `docs%2Freadme.txt` → 201. **Body MUST be JSON `{content,…}` — raw bytes rejected `400 INVALID_JSON`** (see Bug S-3). |
| 3b | GET object | `GET …/objects/{key}` | **Working** | content roundtrips exactly: `"ACME-SECRET-PAYLOAD-line1\nline2"` |
| 3c | Object metadata | `GET …/objects/{key}/metadata` | **Working** | 200 `{contentType,sizeBytes:31,etag:"36b431…",timestamps}` |
| 3d | List objects | `GET …/objects` | **Working** | 200 both keys with etag/size/storageClass |
| 3e | DELETE object | `DELETE …/objects/{key}` | **Working** (exercised via isolation + cleanup) | 200 `{deleted:true}` on owner; 404 on cross-tenant |
| 4 | Workspace usage | `GET /v1/storage/workspaces/$TA_WS/usage` | **Working (live)** | `collectionMethod:"live"`; dims totalBytes/bucketCount/objectCount + per-bucket breakdown. (Quirk: `bucketCount` comes from DB registry, bytes/objects from live S3 — see Bug S-4.) |

## Bucket naming (S3 layer)
Buckets are created in S3 with the **raw resourceId** = a generated bucket name (`lcs32332527493`), **NOT** tenant/workspace-prefixed. There is no `tenant_…/ws_…` namespacing at the S3 bucket level. Tenant attribution lives only in the control-plane DB table `workspace_buckets` (bucket_name → tenant_id/workspace_id), consulted by `denyUnlessBucketOwner`/`storageListBuckets`.

---

## ISOLATION VERDICT

### API layer (gateway + control-plane) — **PROVEN ISOLATED** ✅
For every cross-tenant op (acme→globex AND globex→acme) the server returns **404 with no existence leak**:

| Probe (acme-ops → globex bucket `lcs3glb17328`) | Status |
|---|---|
| GET object `globex-secret.txt` | 404 `BUCKET_NOT_FOUND` |
| GET object metadata | 404 `BUCKET_NOT_FOUND` |
| LIST bucket objects | 404 `BUCKET_NOT_FOUND` |
| PUT (write) object | 404 `BUCKET_NOT_FOUND` |
| DELETE object | 404 `BUCKET_NOT_FOUND` |
| GET workspace usage (`$TB_WS`) | 404 `WORKSPACE_NOT_FOUND` |
| PROVISION bucket in `$TB_WS` | 404 `WORKSPACE_NOT_FOUND` |

Reverse (globex-ops → acme bucket `lcs32332527493`): GET object / LIST / usage all 404. globex's `globex-secret.txt` confirmed **intact** after acme's rejected DELETE (re-GET as globex → 200, content unchanged). Unauthenticated → 401 `UNAUTHENTICATED`. List is correctly scoped (each tenant sees only its own buckets). Mechanism (code): `denyUnlessBucketOwner` → `rec.tenant_id !== ctx.identity.tenantId ⇒ err(404)`; identity.tenantId from the verified JWT `tenant_id` claim. **No IDOR at the API layer.**

### Direct S3 / SeaweedFS layer — **BROKEN (by design of the deployment)** ❌
SeaweedFS is configured with a **single shared root identity** — secret `in-falcone-seaweedfs-s3-config.seaweedfs_s3_config` has `identities` count **1**: `name=falcone-s3-admin`, `actions=[Admin,Read,Write,List,Tagging]`, 1 credential (accessKeyPrefix `2Q8g…`, matching `in-falcone-storage.s3_access_key`, 20-char AK / 40-char SK). **No per-tenant S3 identities exist.** With that single credential (the only S3 cred the deployment has):

```
[S3-1] ListBuckets → ["lcs32332527493","lcs3glb17328"]   # BOTH tenants visible
[S3-3] ListObjectsV2 (globex bucket) → ["globex-secret.txt"]
[S3-4] GetObject globex/globex-secret.txt → "GLOBEX-CONFIDENTIAL-DATA"   # cross-tenant READ
[S3-5] GetObject acme/greeting.txt → "ACME-SECRET-PAYLOAD-line1\nline2"
[S3-6] PutObject acme/direct-s3-write.txt → OK
[S3-7] PutObject GLOBEX/cross-tenant-injected.txt → OK   # cross-tenant WRITE
```
Bidirectional REST↔S3 visibility proven:
- Object written via **direct S3** (`direct-s3-write.txt`) is visible+readable via acme's **REST API** (200, content `"WRITTEN-VIA-DIRECT-S3"`).
- Object **injected via direct S3 into globex's bucket** (`cross-tenant-injected.txt`) appears in **globex's REST object listing** (victim sees the planted object) — the breach is real from the victim's perspective.

**Verdict:** Storage tenant isolation is **EMPIRICALLY PROVEN at the API layer** and **EMPIRICALLY BROKEN at the direct-S3 layer**. Isolation depends entirely on the control-plane gate; anyone holding the shared S3 root credential (`in-falcone-storage`) bypasses all tenant boundaries — full cross-tenant read AND write. This matches the SeaweedFS-migration design intent (net-new per-tenant S3 identities) which is **NOT deployed in this runtime**.

---

## BUGS

- **S-1 (P1, tenant-isolation, data-plane):** Single shared SeaweedFS root credential → no S3-layer tenant isolation. Holder of `in-falcone-storage` s3_access_key/s3_secret_key can list/read/write ALL tenants' buckets directly (proven above: read globex secret, write into globex bucket). Repro: `node @aws-sdk/client-s3` to `localhost:18333` with the shared cred → `ListBuckets` returns both tenants' buckets; `GetObject`/`PutObject` on the other tenant's bucket succeeds. Mitigated only if the S3 credential is never exposed to tenant workloads and no `/storage/.../credentials` route hands per-tenant creds (those routes are NOT deployed here, so today no tenant can obtain a direct S3 cred — but the platform-shared cred is itself the single point of total cross-tenant compromise). Per-tenant SeaweedFS identities (SeaweedFS-migration epic) are the intended fix and are not yet live.

- **S-2 (P2, naming):** S3 bucket names are the raw resourceId with no tenant/workspace prefix or namespace. Tenant binding lives only in the `workspace_buckets` DB table; a bucket-name collision across tenants is theoretically possible (provision uses a random-ish name so low-prob, but there's no S3-level tenant namespace as a defense-in-depth).

- **S-3 (P2, API ergonomics/contract):** Object PUT rejects raw bodies — `PUT …/objects/{key}` with `text/plain` or binary body → `400 INVALID_JSON`. The handler only accepts JSON `{"content":"…","contentType":"…"}` (`ctx.body?.content`). This is not S3-PUT-compatible: binary content must be embedded in a JSON string field (no base64 path observed), so true binary objects can't be stored faithfully via the REST API. Documented as a deployed contract constraint, not a crash.

- **S-4 (P2, consistency):** `GET /v1/storage/workspaces/{ws}/usage` `bucketCount` is derived from the DB `workspace_buckets` registry while `objectCount`/`totalBytes` are read from live S3. After a bucket disappears from S3 (or an orphaned DB row exists) the two diverge — e.g. post-cleanup usage showed `bucketCount:1` but `objectCount:0` and an empty `buckets[]` payload at the S3 level. No bucket-DELETE API exists in this runtime to reconcile the registry.

## NOT DEPLOYED (not bugs)
`POST /v1/storage/buckets`, `GET/DELETE /v1/storage/buckets/{id}`, per-workspace storage credentials & rotations, usage/tenants & tenant usage, workspace audit, exports/imports, `/v1/storage/audit/coverage`, `/v1/platform/storage/provider`, `/v1/tenants/{id}/storage-context` → all 404 `NO_ROUTE` in this kind runtime (exist only in internal-contracts catalog).

## Could not test / limitations
- **No bucket-DELETE route** is deployed → could not remove provisioned bucket *records*. I cleaned the **S3 objects + buckets** directly (both buckets `lcs32332527493`, `lcs3glb17328` and all objects DELETED via S3 — confirmed `ListBuckets` empty intent; both tenants' REST `GET /v1/storage/buckets` now return `{items:[],size:0}`). The two `workspace_buckets` **DB registry rows remain orphaned** (still surface in the `usage.bucketCount`/`buckets[]` view): a direct `DELETE FROM workspace_buckets` in the shared postgres pod was **denied by the harness policy**, and no API route can remove them. Footprint is harmless (no leak; list-buckets is S3-backed and empty) but not 100% pristine.
- Per-tenant storage credential issuance untested (route not deployed).
- Presigned URLs / multipart / object tagging / lifecycle untested (no deployed routes; adapter modules exist in `services/adapters/src/storage-*.mjs` but are not wired into this runtime).
