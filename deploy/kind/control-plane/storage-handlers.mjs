// Console storage (object store) handlers — REAL MinIO/S3 (kind deploy).
//
// MinIO runs as `falcone-storage:9000`. The web-console Storage page reads buckets,
// objects, object metadata, and per-workspace usage. We talk to MinIO over the S3
// REST API with AWS Signature V4 (pure node:crypto — no SDK). Buckets are mapped to
// a workspace via the `workspace_buckets` table (provisioned through this control
// plane), so the page's `bucket.workspaceId === activeWorkspaceId` filter works and
// usage is workspace-scoped.
import crypto from 'node:crypto';
import * as store from './tenant-store.mjs';
import { issueBucketIdentity, revokeBucketIdentity } from './seaweedfs-identity.mjs';

// Provider-neutral S3 endpoint/credentials (SeaweedFS S3 gateway port 8333, MinIO 9000,
// or any S3-compatible backend). Legacy MINIO_* names remain as backward-compatible
// fallbacks; a single startup deprecation notice fires when they are used.
const ENDPOINT = (process.env.STORAGE_S3_ENDPOINT || process.env.MINIO_ENDPOINT || 'http://falcone-storage:9000').replace(/\/+$/, '');
const ACCESS = process.env.STORAGE_S3_ACCESS_KEY || process.env.MINIO_ACCESS_KEY || '';
const SECRET = process.env.STORAGE_S3_SECRET_KEY || process.env.MINIO_SECRET_KEY || '';
const REGION = process.env.STORAGE_S3_REGION || process.env.MINIO_REGION || 'us-east-1';
const EMPTY_SHA = crypto.createHash('sha256').update('').digest('hex');

if (!process.env.STORAGE_S3_ENDPOINT && process.env.MINIO_ENDPOINT) {
  console.warn('[storage] MINIO_ENDPOINT is deprecated; set STORAGE_S3_ENDPOINT (and STORAGE_S3_ACCESS_KEY / STORAGE_S3_SECRET_KEY) instead. Falling back to MINIO_* for now.');
}

const ok = (statusCode, body) => ({ statusCode, body });
const err = (statusCode, code, message) => ({ statusCode, body: { code, message } });
const nowIso = () => new Date().toISOString();

// Map an S3-backend failure thrown by `s3()` to a CLEAN, tenant-facing error — never echoing
// the raw backend payload. The thrown error embeds the literal backend body and the INTERNAL
// physical bucket path in `e.message` (`s3 <METHOD> <path> -> <status>: <xml…>`) and the full
// raw text in `e.body`; surfacing either to the caller leaks SeaweedFS internals (the S3 XML
// `NoSuchKey`/`<Resource>`/`<RequestId>` and the `ws-<hash>-…` physical bucket name) — #675.
//
// For object I/O the bucket-ownership gate (denyUnlessBucketOwner / the inline registry check)
// ALWAYS runs BEFORE the S3 call, so a 404 here is unambiguously a MISSING OBJECT (NoSuchKey)
// on a bucket the caller owns — mapped to the canonical `404 OBJECT_NOT_FOUND` with the exact
// stable message from services/adapters/src/storage-error-taxonomy.mjs (duplicated inline
// because this kind-runtime image cannot import the services package). Any other backend
// failure keeps the operation-specific failure code but with a generic message — the upstream
// detail is logged server-side (operators only), never returned. `fallbackCode` is e.g.
// 'STORAGE_GET_FAILED' / 'STORAGE_HEAD_FAILED'.
function storageFailure(e, fallbackCode) {
  // 404 from the backend, after the ownership gate has passed → the object does not exist.
  if (e?.statusCode === 404) {
    console.error(`[storage] backend 404 mapped to OBJECT_NOT_FOUND: ${String(e?.message ?? e)}`);
    return err(404, 'OBJECT_NOT_FOUND', 'The requested storage object was not found.');
  }
  // Any other backend failure: preserve a sane status but NEVER echo the raw payload/path.
  const status = e?.statusCode && e.statusCode < 500 ? e.statusCode : 502;
  console.error(`[storage] backend failure (${fallbackCode}, status ${status}): ${String(e?.message ?? e)}`);
  return err(status, fallbackCode, 'Storage backend request failed.');
}

const sha256hex = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// Physical, DNS-safe bucket name for a workspace's logical bucket. The name embeds
// a stable hash of the GLOBALLY-UNIQUE workspace id, so two tenants' same-slug
// workspaces (or two tenants both requesting the bucket name `assets`) get DISTINCT
// physical buckets (P1: the old slug-derived `ws-<slug>-assets` collided across
// tenants and `insertBucket`'s ON CONFLICT hijacked the first tenant's registry
// row). Mirrors the shippable product's hash-based `deriveWorkspaceBucketName`
// (services/adapters/src/seaweedfs-s3-identities-config.mjs); duplicated inline
// because this kind-runtime image cannot import the services package. Pure +
// deterministic, so a given (workspace, name) always maps to the same bucket
// (idempotent provisioning; the per-workspace S3 identity can reference it).
export function deriveBucketName(workspaceId, requestedName) {
  const wsHash = crypto.createHash('sha256').update(`workspace:${String(workspaceId ?? '')}`).digest('hex').slice(0, 12);
  const nameFrag = String(requestedName ?? 'assets').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const bucket = `ws-${wsHash}-${nameFrag || 'assets'}`.replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/g, '');
  return bucket;
}

// Whether to issue a per-workspace (scoped) SeaweedFS identity on bucket provision.
// DEFAULT-ON: enabled unless explicitly disabled (STORAGE_TENANT_IDENTITIES=0/false).
// Defaulting on (rather than requiring =1) means it cannot be silently lost when a
// Helm values overlay REPLACES the control-plane env list — the failure mode that left
// the live deploy on a single shared admin S3 credential (P1 tenant-isolation).
export function tenantIdentitiesEnabled(env = process.env) {
  const v = String(env.STORAGE_TENANT_IDENTITIES ?? '').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no';
}
// AWS RFC3986 encoding (encodeURIComponent + the extra reserved chars AWS escapes).
const enc = (s) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function amzDates() {
  const d = new Date();
  const amzDate = d.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

// Signed S3 request (path-style). `path` is the raw path incl. leading '/'
// (e.g. '/', '/bucket', '/bucket/key'); `query` is an object of query params.
async function s3(method, path, { query = {}, headers = {}, body } = {}) {
  const url = new URL(ENDPOINT);
  const host = url.host;
  const payload = body ?? '';
  const payloadHash = body ? sha256hex(body) : EMPTY_SHA;
  const { amzDate, dateStamp } = amzDates();

  const canonicalUri = path.split('/').map((seg, i) => (i === 0 ? seg : enc(seg))).join('/') || '/';
  const canonicalQuery = Object.keys(query).sort()
    .map((k) => `${enc(k)}=${enc(String(query[k]))}`).join('&');

  const hdrs = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const signedHeaders = Object.keys(hdrs).sort().join(';');
  const canonicalHeaders = Object.keys(hdrs).sort().map((k) => `${k}:${hdrs[k]}\n`).join('');
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${dateStamp}/${REGION}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kDate = hmac('AWS4' + SECRET, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, 's3');
  const signingKey = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${ACCESS}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const qs = canonicalQuery ? `?${canonicalQuery}` : '';
  const res = await fetch(`${ENDPOINT}${canonicalUri}${qs}`, {
    method,
    headers: { ...headers, authorization, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate },
    body: body ?? undefined
  });
  // Read the body once as raw bytes, then derive text from it — so binary objects round-trip
  // byte-identically (await res.text() would lossily UTF-8-decode an octet stream). Real fetch
  // always exposes arrayBuffer(); fall back to text() only for minimal mocks/runtimes.
  const buffer = method === 'HEAD'
    ? Buffer.alloc(0)
    : typeof res.arrayBuffer === 'function'
      ? Buffer.from(await res.arrayBuffer())
      : Buffer.from(await res.text());
  const text = buffer.toString('utf8');
  if (!res.ok) {
    const e = new Error(`s3 ${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
    e.statusCode = res.status; e.body = text;
    throw e;
  }
  return { status: res.status, headers: res.headers, text, buffer };
}

// minimal XML helpers for the (simple, known) S3 list responses.
// Entity-aware + CDATA-tolerant: SeaweedFS (and other gateways) may encode characters
// in bucket names / object keys (`&amp; &lt; &gt; &quot; &#34;`) or wrap text in
// <![CDATA[...]]>. We decode the common entity set and strip CDATA wrappers before
// returning tag content, while staying byte-compatible with the real SeaweedFS 4.33
// envelopes captured in the adr-spike (`&#34;`-quoted ETags, NextContinuationToken).
const stripCdata = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
const decodeXmlEntities = (s) => s
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#34;/g, '"')
  .replace(/&#x22;/gi, '"')
  .replace(/&apos;/g, '\'')
  .replace(/&#39;/g, '\'')
  .replace(/&amp;/g, '&'); // ampersand last so we don't double-decode
const decodeTagContent = (s) => (s == null ? null : decodeXmlEntities(stripCdata(s)));
const allTags = (xml, tag) => {
  const out = []; const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'); let m;
  while ((m = re.exec(xml))) out.push(decodeTagContent(m[1]));
  return out;
};
const oneTag = (xml, tag) => { const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)); return m ? decodeTagContent(m[1]) : null; };

export async function listBuckets() {
  const { text } = await s3('GET', '/');
  return allTags(text, 'Bucket').map((b) => ({ name: oneTag(b, 'Name'), creationDate: oneTag(b, 'CreationDate') }));
}
export async function listObjects(bucket, { maxKeys = 50, after } = {}) {
  const query = { 'list-type': '2', 'max-keys': String(maxKeys) };
  if (after) query['continuation-token'] = after;
  const { text } = await s3('GET', `/${bucket}`, { query });
  const objects = allTags(text, 'Contents').map((c) => ({
    key: oneTag(c, 'Key'), size: Number(oneTag(c, 'Size') ?? 0), etag: (oneTag(c, 'ETag') ?? '').replace(/&quot;|&#34;|"/g, ''),
    lastModified: oneTag(c, 'LastModified'), storageClass: oneTag(c, 'StorageClass') ?? 'STANDARD'
  }));
  const truncated = oneTag(text, 'IsTruncated') === 'true';
  return { objects, nextToken: truncated ? oneTag(text, 'NextContinuationToken') : null };
}
export async function headObject(bucket, key) {
  const { headers } = await s3('HEAD', `/${bucket}/${key}`);
  return {
    contentType: headers.get('content-type') ?? null,
    size: Number(headers.get('content-length') ?? 0),
    etag: (headers.get('etag') ?? '').replace(/"/g, ''),
    lastModified: headers.get('last-modified') ?? null
  };
}
export async function createBucket(bucket) {
  try { await s3('PUT', `/${bucket}`); }
  catch (e) { if (!/BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(e.body ?? '')) throw e; }
}
// Delete a bucket (best-effort teardown for tenant purge, #501). SeaweedFS removes the bucket
// and its objects; a missing bucket (already gone / never created) is treated as success.
export async function deleteBucket(bucket) {
  try { await s3('DELETE', `/${bucket}`); }
  catch (e) { if (!/NoSuchBucket|404/.test(String(e.body ?? e.message ?? ''))) throw e; }
}
export async function putObject(bucket, key, body, contentType = 'application/octet-stream') {
  await s3('PUT', `/${bucket}/${key}`, { headers: { 'content-type': contentType }, body });
}
// Download an object's body (add-wire-advertised-public-routes, #500 — object I/O was NO_ROUTE).
// Returns the exact bytes plus a best-effort UTF-8 view; callers needing binary fidelity use `bytes`.
export async function getObject(bucket, key) {
  const { buffer, headers } = await s3('GET', `/${bucket}/${key}`);
  return { content: buffer.toString('utf8'), bytes: buffer, contentType: headers.get('content-type') ?? 'application/octet-stream', sizeBytes: Number(headers.get('content-length') ?? buffer.length) };
}
export async function deleteObject(bucket, key) {
  await s3('DELETE', `/${bucket}/${key}`);
}

// Ownership gate: returns true for superadmin/internal (cross-tenant allowed),
// false for all other actors so each handler can enforce a 404 (no-existence-leak).
function isSuperOrInternal(identity) {
  return identity.actorType === 'superadmin' || identity.actorType === 'internal';
}

// Shared bucket-ownership gate for object I/O: superadmin/internal bypass; others must own the
// bucket (else 404, no existence leak). Returns an error response to short-circuit, or null.
async function denyUnlessBucketOwner(ctx, bucket) {
  if (isSuperOrInternal(ctx.identity)) return null;
  const rec = await store.getBucketRecord(ctx.pool, bucket);
  if (!rec || rec.tenant_id !== ctx.identity.tenantId) return err(404, 'BUCKET_NOT_FOUND', `bucket ${bucket} not found`);
  return null;
}

// Decode + validate a single object key from the route param, applying the SAME policy as the
// platform storage adapter (services/adapters/src/storage-bucket-object-ops.mjs::assertObjectKey):
// reject traversal ('..' segments), a leading '/', backslashes, control characters, an empty/too-
// long key, and malformed percent-encoding — with a clean 400 BEFORE any S3 backend call. Without
// this, a traversal probe (e.g. `..%2F..%2Fetc%2Fpasswd`) reached the backend, which rejected the
// malformed path, and that surfaced to the caller as a 5xx STORAGE_*_FAILED (502) instead of a 4xx
// (#638). No data escapes the bucket either way, but a 5xx for malicious client input is a defect.
const OBJECT_KEY_MAX_LEN = 1024;
function decodeObjectKey(rawKey) {
  let key;
  try { key = decodeURIComponent(rawKey); }
  catch { return { error: err(400, 'INVALID_OBJECT_KEY', 'object key is not valid percent-encoding') }; }
  const invalid = (msg) => ({ error: err(400, 'INVALID_OBJECT_KEY', msg) });
  if (typeof key !== 'string' || !key.trim()) return invalid('object key is required');
  if (key.length > OBJECT_KEY_MAX_LEN) return invalid(`object key exceeds ${OBJECT_KEY_MAX_LEN} characters`);
  if (key.startsWith('/')) return invalid('object key must not start with "/"');
  if (key.includes('\\')) return invalid('object key must not contain a backslash');
  for (let i = 0; i < key.length; i += 1) {
    const code = key.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return invalid('object key must not contain control characters');
  }
  if (key.split('/').some((seg) => seg === '..')) return invalid('object key must not contain ".." path segments');
  return { key };
}

// ---- handlers (ctx = { params, query, body, identity, pool, callerContext }) ----
// Object I/O — upload/download/delete a single object (#500). Tenant-scoped via the bucket owner
// gate. Objects are stored byte-faithfully: an upload may carry EITHER a raw/binary request body
// (any non-JSON content-type → ctx.rawBody) OR the JSON envelope { content, contentType, encoding }
// where encoding:'base64' carries binary inside JSON. Download returns the UTF-8 view plus
// contentBase64 so binary round-trips byte-identically over the JSON API.
export function resolveObjectBody(ctx) {
  // Raw binary upload: the server kept the exact request bytes (non-JSON content-type).
  if (ctx.rawBodyIsBinary && Buffer.isBuffer(ctx.rawBody)) {
    return { bytes: ctx.rawBody, contentType: ctx.contentType || 'application/octet-stream' };
  }
  // JSON envelope: { content, contentType, encoding? }. base64 decodes to exact bytes; otherwise the
  // string is stored as UTF-8 (the existing text/JSON-blob behavior).
  const env = ctx.body ?? {};
  const contentType = env.contentType ?? 'application/octet-stream';
  const bytes = env.encoding === 'base64'
    ? Buffer.from(String(env.content ?? ''), 'base64')
    : Buffer.from(String(env.content ?? ''), 'utf8');
  return { bytes, contentType };
}
async function storagePutObject(ctx) {
  const { key, error } = decodeObjectKey(ctx.params.objectKey); if (error) return error;
  const bucket = ctx.params.bucketId; const deny = await denyUnlessBucketOwner(ctx, bucket); if (deny) return deny;
  const { bytes, contentType } = resolveObjectBody(ctx);
  try {
    await putObject(bucket, key, bytes, contentType);
    return ok(201, { objectKey: key, bucketName: bucket, sizeBytes: bytes.length, contentType });
  } catch (e) { return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'STORAGE_PUT_FAILED', String(e.message ?? e)); }
}
async function storageGetObject(ctx) {
  const { key, error } = decodeObjectKey(ctx.params.objectKey); if (error) return error;
  const bucket = ctx.params.bucketId; const deny = await denyUnlessBucketOwner(ctx, bucket); if (deny) return deny;
  try {
    const o = await getObject(bucket, key);
    return ok(200, { objectKey: key, bucketName: bucket, content: o.content, contentBase64: o.bytes.toString('base64'), encoding: 'base64', contentType: o.contentType, sizeBytes: o.sizeBytes });
  } catch (e) { return storageFailure(e, 'STORAGE_GET_FAILED'); }
}
async function storageDeleteObject(ctx) {
  const { key, error } = decodeObjectKey(ctx.params.objectKey); if (error) return error;
  const bucket = ctx.params.bucketId; const deny = await denyUnlessBucketOwner(ctx, bucket); if (deny) return deny;
  try {
    await deleteObject(bucket, key);
    return ok(200, { objectKey: key, bucketName: bucket, deleted: true });
  } catch (e) { return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'STORAGE_DELETE_FAILED', String(e.message ?? e)); }
}
async function storageListBuckets(ctx) {
  const all = await listBuckets();
  const map = await store.bucketWorkspaceMap(ctx.pool);
  const isSuperadmin = isSuperOrInternal(ctx.identity);
  const items = all
    .map((b) => {
      const m = map[b.name];
      return {
        resourceId: b.name, bucketName: b.name,
        tenantId: m?.tenant_id ?? null, workspaceId: m?.workspace_id ?? null,
        region: REGION, status: 'active',
        timestamps: { createdAt: m?.created_at ?? b.creationDate, lastModifiedAt: b.creationDate }
      };
    })
    // Non-superadmin callers see only their own tenant's buckets.
    .filter((item) => isSuperadmin || item.tenantId === ctx.identity.tenantId);
  return ok(200, { items, page: { size: items.length } });
}
async function storageListObjects(ctx) {
  const bucket = ctx.params.bucketId;
  // Ownership check: look up the bucket's owning tenant and compare to caller.
  // Superadmin/internal bypass the check. Non-owners get 404 (no existence leak).
  if (!isSuperOrInternal(ctx.identity)) {
    const rec = await store.getBucketRecord(ctx.pool, bucket);
    if (!rec || rec.tenant_id !== ctx.identity.tenantId) {
      return err(404, 'BUCKET_NOT_FOUND', `bucket ${bucket} not found`);
    }
  }
  const max = Number(ctx.query['page[size]'] ?? 50) || 50;
  const after = ctx.query['page[after]'] || undefined;
  try {
    const { objects, nextToken } = await listObjects(bucket, { maxKeys: max, after });
    const items = objects.map((o) => ({
      objectKey: o.key, bucketName: bucket, sizeBytes: o.size, etag: o.etag,
      storageClass: o.storageClass, timestamps: { lastModifiedAt: o.lastModified }
    }));
    return ok(200, { items, page: { size: items.length, nextCursor: nextToken ?? undefined, after: nextToken ?? undefined } });
  } catch (e) {
    return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'STORAGE_LIST_FAILED', String(e.message ?? e));
  }
}
async function storageObjectMetadata(ctx) {
  const { key, error } = decodeObjectKey(ctx.params.objectKey); if (error) return error;
  const bucket = ctx.params.bucketId;
  // Ownership check: same pattern as storageListObjects.
  if (!isSuperOrInternal(ctx.identity)) {
    const rec = await store.getBucketRecord(ctx.pool, bucket);
    if (!rec || rec.tenant_id !== ctx.identity.tenantId) {
      return err(404, 'BUCKET_NOT_FOUND', `bucket ${bucket} not found`);
    }
  }
  try {
    const meta = await headObject(bucket, key);
    return ok(200, { objectKey: key, bucketName: bucket, contentType: meta.contentType,
      sizeBytes: meta.size, etag: meta.etag, timestamps: { lastModifiedAt: meta.lastModified } });
  } catch (e) {
    return storageFailure(e, 'STORAGE_HEAD_FAILED');
  }
}
async function storageWorkspaceUsage(ctx) {
  const workspaceId = ctx.params.workspaceId;
  // Ownership check: verify the workspace belongs to the caller's tenant.
  // Superadmin/internal bypass the check. Non-owners get 404 (no existence leak).
  if (!isSuperOrInternal(ctx.identity)) {
    const ws = await store.getWorkspace(ctx.pool, workspaceId);
    if (!ws || ws.tenant_id !== ctx.identity.tenantId) {
      return err(404, 'WORKSPACE_NOT_FOUND', `workspace ${workspaceId} not found`);
    }
  }
  const mapped = await store.listBucketsForWorkspace(ctx.pool, workspaceId);
  let totalBytes = 0, objectCount = 0; const bucketEntries = [];
  for (const row of mapped) {
    try {
      const { objects } = await listObjects(row.bucket_name, { maxKeys: 1000 });
      const bytes = objects.reduce((s, o) => s + o.size, 0);
      totalBytes += bytes; objectCount += objects.length;
      bucketEntries.push({ bucketId: row.bucket_name, totalBytes: bytes, objectCount: objects.length,
        largestObjectSizeBytes: objects.reduce((mx, o) => Math.max(mx, o.size), 0) });
    } catch { bucketEntries.push({ bucketId: row.bucket_name, totalBytes: 0, objectCount: 0, largestObjectSizeBytes: 0 }); }
  }
  const dim = (used) => ({ used, limit: null, remaining: null, utilizationPercent: null });
  return ok(200, {
    collectionMethod: 'live', collectionStatus: 'complete', snapshotAt: nowIso(), cacheSnapshotAt: null,
    dimensions: { totalBytes: { dimension: 'totalBytes', ...dim(totalBytes) }, bucketCount: { dimension: 'bucketCount', ...dim(mapped.length) },
      objectCount: { dimension: 'objectCount', ...dim(objectCount) }, objectSizeBytes: { dimension: 'objectSizeBytes', ...dim(totalBytes) } },
    buckets: bucketEntries
  });
}
// POST /v1/storage/workspaces/{workspaceId}/buckets — provision a real bucket + map it.
async function storageProvisionBucket(ctx) {
  const workspaceId = ctx.params.workspaceId;
  const ws = await store.getWorkspace(ctx.pool, workspaceId);
  if (!ws) return err(404, 'WORKSPACE_NOT_FOUND', `workspace ${workspaceId} not found`);
  // Ownership check: only superadmin/internal or the workspace-owning tenant may provision.
  if (!isSuperOrInternal(ctx.identity) && ws.tenant_id !== ctx.identity.tenantId) {
    return err(404, 'WORKSPACE_NOT_FOUND', `workspace ${workspaceId} not found`);
  }
  // DNS-safe, workspace-id-scoped bucket name. deriveBucketName embeds a stable hash
  // of the globally-unique workspace id so two same-slug workspaces across tenants
  // (or two tenants both requesting `assets`) NEVER collide on one physical bucket
  // or one registry row (P1 tenant-isolation). The DNS rule ([a-z0-9-], 3..63) is the
  // canonical one from services/provisioning-orchestrator/src/utils/bucket-name-validator.mjs.
  const bucket = deriveBucketName(ws.id, ctx.body?.name);
  // Reject before any backend call if the derived name still violates the contract.
  if (!/^[a-z0-9-]{3,63}$/.test(bucket)) {
    return err(400, 'STORAGE_INVALID_BUCKET_NAME', `derived bucket name '${bucket}' is not DNS-safe ([a-z0-9-], 3..63)`);
  }
  try {
    await createBucket(bucket);
    const rec = await store.insertBucket(ctx.pool, { workspaceId: ws.id, tenantId: ws.tenant_id, bucketName: bucket, region: REGION });
    // Issue a per-BUCKET SeaweedFS identity scoped to ONLY this bucket (#553, #673), so
    // the tenant gets a credential that can't reach ANY other bucket — not another
    // tenant's bucket AND not a sibling bucket in the same workspace — instead of sharing
    // the broad admin/master key. Keyed on the (globally-unique, workspace-embedding)
    // physical bucket name; the issuer does delete-then-apply so a re-provision is a clean
    // rotate (exactly one active key, no accumulation) — fixing #673, where a single
    // per-workspace identity accumulated a grant + a new key for EVERY bucket so a cred
    // "scoped to bucket A" could list buckets B/C in the same workspace. Best-effort: a
    // failure here must not fail the provision (the bucket is still usable via the
    // tenant-gated REST API); the credential can be re-issued via the rotate endpoint.
    // Enabled by DEFAULT (filer-mode) — see tenantIdentitiesEnabled: gating only on
    // STORAGE_TENANT_IDENTITIES=1 meant a values overlay that REPLACED the control-plane
    // env list silently dropped the flag, so every provision returned storageCredential:
    // null and a single shared admin cred served all tenants (P1 tenant-isolation, live
    // 2026-06-18). It can still be turned off explicitly (='0').
    let storageCredential = null;
    if (tenantIdentitiesEnabled()) {
      try {
        const issued = await issueBucketIdentity({ bucket, workspaceId: ws.id });
        // Return the one-time secret to the caller; never persist the plaintext secret.
        storageCredential = { identityName: issued.identityName, accessKey: issued.accessKey, secretKey: issued.secretKey, bucket: issued.bucket, actions: issued.actions };
      } catch (e) {
        console.error('[storage] per-bucket identity issuance failed (bucket provisioned without a scoped credential):', e?.message ?? e);
      }
    }
    return ok(201, { bucket: { resourceId: bucket, bucketName: bucket, workspaceId: ws.id, tenantId: ws.tenant_id, region: REGION, status: 'active' }, record: rec, storageCredential });
  } catch (e) {
    return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'STORAGE_PROVISION_FAILED', String(e.message ?? e));
  }
}

// POST /v1/storage/buckets/{bucketId}/credentials — ROTATE the bucket's storage
// credential (#673). Re-issues the per-bucket identity (delete-then-apply), so the
// PRIOR access key for this bucket no longer authenticates and a single fresh key
// scoped to ONLY this bucket is returned. Bucket-keyed (not product credentialId-keyed)
// to match the existing kind storage routes; the response is the same `storageCredential`
// shape `storageProvisionBucket` returns. Ownership-gated exactly like object I/O.
async function storageRotateCredential(ctx) {
  const bucket = ctx.params.bucketId;
  const deny = await denyUnlessBucketOwner(ctx, bucket); if (deny) return deny;
  // The bucket must exist in the registry (a superadmin bypasses the owner check above,
  // so confirm existence here rather than leaking a 404 vs 200 distinction by ownership).
  const rec = await store.getBucketRecord(ctx.pool, bucket);
  if (!rec) return err(404, 'BUCKET_NOT_FOUND', `bucket ${bucket} not found`);
  if (!tenantIdentitiesEnabled()) {
    return err(409, 'STORAGE_IDENTITIES_DISABLED', 'per-bucket storage identities are disabled (STORAGE_TENANT_IDENTITIES=0)');
  }
  try {
    // ctx.seaweedClient is an OPTIONAL test seam (the in-pod default is the real k8s
    // client inside seaweedfs-identity.mjs); production passes nothing → real client.
    const issued = await issueBucketIdentity({ bucket, workspaceId: rec.workspace_id, ...(ctx.seaweedClient ? { client: ctx.seaweedClient } : {}) });
    return ok(200, { storageCredential: { identityName: issued.identityName, accessKey: issued.accessKey, secretKey: issued.secretKey, bucket: issued.bucket, actions: issued.actions } });
  } catch (e) {
    return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'STORAGE_CREDENTIAL_ROTATE_FAILED', String(e.message ?? e));
  }
}

// DELETE /v1/storage/buckets/{bucketId}/credentials — REVOKE the bucket's storage
// credential (#673). Deletes the per-bucket SeaweedFS identity (and all its keys) so the
// prior access key is rejected. Idempotent (revoking when no identity exists still
// succeeds). Ownership-gated exactly like object I/O.
async function storageRevokeCredential(ctx) {
  const bucket = ctx.params.bucketId;
  const deny = await denyUnlessBucketOwner(ctx, bucket); if (deny) return deny;
  const rec = await store.getBucketRecord(ctx.pool, bucket);
  if (!rec) return err(404, 'BUCKET_NOT_FOUND', `bucket ${bucket} not found`);
  try {
    // ctx.seaweedClient is an OPTIONAL test seam (see storageRotateCredential).
    await revokeBucketIdentity({ bucket, ...(ctx.seaweedClient ? { client: ctx.seaweedClient } : {}) });
    return ok(200, { bucket, revoked: true });
  } catch (e) {
    return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'STORAGE_CREDENTIAL_REVOKE_FAILED', String(e.message ?? e));
  }
}

export const STORAGE_HANDLERS = {
  storageListBuckets, storageListObjects, storageObjectMetadata, storageWorkspaceUsage, storageProvisionBucket,
  storagePutObject, storageGetObject, storageDeleteObject,
  storageRotateCredential, storageRevokeCredential
};
