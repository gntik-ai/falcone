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
import { issueWorkspaceIdentity } from './seaweedfs-identity.mjs';

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

const sha256hex = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
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
  const text = method === 'HEAD' ? '' : await res.text();
  if (!res.ok) {
    const e = new Error(`s3 ${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
    e.statusCode = res.status; e.body = text;
    throw e;
  }
  return { status: res.status, headers: res.headers, text };
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
export async function getObject(bucket, key) {
  const { text, headers } = await s3('GET', `/${bucket}/${key}`);
  return { content: text, contentType: headers.get('content-type') ?? 'application/octet-stream', sizeBytes: Number(headers.get('content-length') ?? Buffer.byteLength(text)) };
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

// ---- handlers (ctx = { params, query, body, identity, pool, callerContext }) ----
// Object I/O — upload/download/delete a single object (#500). Tenant-scoped via the bucket owner
// gate. Content is carried as a string in the JSON envelope (text/JSON blobs — the common data-API
// case); binary streaming is a later refinement.
async function storagePutObject(ctx) {
  const bucket = ctx.params.bucketId; const deny = await denyUnlessBucketOwner(ctx, bucket); if (deny) return deny;
  const key = decodeURIComponent(ctx.params.objectKey);
  const content = ctx.body?.content ?? '';
  const contentType = ctx.body?.contentType ?? 'application/octet-stream';
  try {
    await putObject(bucket, key, content, contentType);
    return ok(201, { objectKey: key, bucketName: bucket, sizeBytes: Buffer.byteLength(content), contentType });
  } catch (e) { return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'STORAGE_PUT_FAILED', String(e.message ?? e)); }
}
async function storageGetObject(ctx) {
  const bucket = ctx.params.bucketId; const deny = await denyUnlessBucketOwner(ctx, bucket); if (deny) return deny;
  const key = decodeURIComponent(ctx.params.objectKey);
  try {
    const o = await getObject(bucket, key);
    return ok(200, { objectKey: key, bucketName: bucket, content: o.content, contentType: o.contentType, sizeBytes: o.sizeBytes });
  } catch (e) { return err(e.statusCode === 404 ? 404 : 502, 'STORAGE_GET_FAILED', String(e.message ?? e)); }
}
async function storageDeleteObject(ctx) {
  const bucket = ctx.params.bucketId; const deny = await denyUnlessBucketOwner(ctx, bucket); if (deny) return deny;
  const key = decodeURIComponent(ctx.params.objectKey);
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
  const bucket = ctx.params.bucketId;
  // Ownership check: same pattern as storageListObjects.
  if (!isSuperOrInternal(ctx.identity)) {
    const rec = await store.getBucketRecord(ctx.pool, bucket);
    if (!rec || rec.tenant_id !== ctx.identity.tenantId) {
      return err(404, 'BUCKET_NOT_FOUND', `bucket ${bucket} not found`);
    }
  }
  const key = decodeURIComponent(ctx.params.objectKey);
  try {
    const meta = await headObject(bucket, key);
    return ok(200, { objectKey: key, bucketName: bucket, contentType: meta.contentType,
      sizeBytes: meta.size, etag: meta.etag, timestamps: { lastModifiedAt: meta.lastModified } });
  } catch (e) {
    return err(e.statusCode === 404 ? 404 : 502, 'STORAGE_HEAD_FAILED', String(e.message ?? e));
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
  // DNS-safe bucket name (lowercase, [a-z0-9-], 3..63). This is the canonical rule
  // codified in services/provisioning-orchestrator/src/utils/bucket-name-validator.mjs;
  // it is duplicated inline here because this kind-runtime image bundles only
  // deploy/kind/control-plane and cannot import the services package.
  const raw = (ctx.body?.name ?? `ws-${ws.slug ?? ws.id.slice(0, 8)}-assets`).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
  const bucket = raw.length >= 3 ? raw : `ws-${ws.id.slice(0, 8)}`;
  // Reject before any backend call if the derived name still violates the contract.
  if (!/^[a-z0-9-]{3,63}$/.test(bucket)) {
    return err(400, 'STORAGE_INVALID_BUCKET_NAME', `derived bucket name '${bucket}' is not DNS-safe ([a-z0-9-], 3..63)`);
  }
  try {
    await createBucket(bucket);
    const rec = await store.insertBucket(ctx.pool, { workspaceId: ws.id, tenantId: ws.tenant_id, bucketName: bucket, region: REGION });
    // Issue a per-workspace SeaweedFS identity scoped to ONLY this bucket (#553), so the
    // tenant gets a credential that can't reach any other tenant's bucket — instead of
    // sharing the broad admin/master key. Best-effort: a failure here must not fail the
    // provision (the bucket is still usable via the tenant-gated REST API); the credential
    // can be re-issued. Only meaningful in filer-mode (STORAGE_TENANT_IDENTITIES=1).
    let storageCredential = null;
    if (process.env.STORAGE_TENANT_IDENTITIES === '1') {
      try {
        const issued = await issueWorkspaceIdentity({ workspaceId: ws.id, bucket });
        // Return the one-time secret to the caller; never persist the plaintext secret.
        storageCredential = { identityName: issued.identityName, accessKey: issued.accessKey, secretKey: issued.secretKey, bucket: issued.bucket, actions: issued.actions };
      } catch (e) {
        console.error('[storage] per-workspace identity issuance failed (bucket provisioned without a scoped credential):', e?.message ?? e);
      }
    }
    return ok(201, { bucket: { resourceId: bucket, bucketName: bucket, workspaceId: ws.id, tenantId: ws.tenant_id, region: REGION, status: 'active' }, record: rec, storageCredential });
  } catch (e) {
    return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'STORAGE_PROVISION_FAILED', String(e.message ?? e));
  }
}

export const STORAGE_HANDLERS = {
  storageListBuckets, storageListObjects, storageObjectMetadata, storageWorkspaceUsage, storageProvisionBucket,
  storagePutObject, storageGetObject, storageDeleteObject
};
