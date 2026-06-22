// Per-BUCKET SeaweedFS identity issuance for the kind control-plane (#553, #673).
//
// In filer-mode (chart: seaweedfs.s3.enableAuth=false + -iam.readOnly=false), the s3
// gateway loads IAM identities from the filer and picks up changes dynamically. Each
// physical bucket gets its OWN identity scoped to ONLY that bucket via
// `weed shell s3.configure -apply` — so a credential can access exactly the one bucket
// it was provisioned for and is AccessDenied on every other bucket (verified live
// 2026-06-18), instead of everyone sharing the broad admin/master key.
//
// #673 — why per-BUCKET and not per-WORKSPACE: `s3.configure -apply` MERGES into the
// named identity (it does not replace), so a single per-workspace identity reused
// across every bucket provision ACCUMULATED a grant for EVERY bucket in the workspace
// AND a fresh access key per provision (one identity held 15 bucket grants + 5 live
// keys live), letting a credential "scoped to bucket A" list/read buckets B and C in
// the same workspace (intra-workspace least-privilege + credential-lifecycle defect;
// cross-TENANT isolation was always fine). The fix keys the identity on the physical
// bucket name — itself globally unique and workspace-embedding (see
// storage-handlers deriveBucketName: `ws-<wsHash12>-<nameFrag40>`) — and makes every
// (re)provision a clean delete-then-apply so a bucket identity carries EXACTLY ONE
// active key scoped to ONLY its bucket; nothing accumulates. The shippable product
// adapters already do this (services/adapters/src/seaweedfs-s3-identities-config.mjs
// expands every action to `Action:bucket`; storage-programmatic-credentials.mjs has
// rotate/revoke); this kind runtime is brought in line.
//
// The control-plane (node) has no `weed` binary, so it runs a one-shot k8s Job
// (seaweedfs image) that execs the weed-shell seed against the master, then the
// filer-mode gateway authenticates the new key without a restart. The generated keys
// are returned to the caller ONCE (the secret is never persisted here).
//
// NOTE (kind simplification): the seed Job receives the access/secret key via env.
// The shippable product path (services/adapters storage-tenant-context +
// provisionWorkspaceStorageBoundary, wired by wf-con-003) uses the full credential
// builder + one-time secret envelope; this kind runtime mirrors only what the live
// data-plane needs.
import https from 'node:https';
import fs from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';

const SA = '/var/run/secrets/kubernetes.io/serviceaccount';
const NS = (() => { try { return fs.readFileSync(`${SA}/namespace`, 'utf8').trim(); } catch { return 'falcone'; } })();
const CA = (() => { try { return fs.readFileSync(`${SA}/ca.crt`); } catch { return undefined; } })();
const readToken = () => { try { return fs.readFileSync(`${SA}/token`, 'utf8').trim(); } catch { return ''; } };
const HOST = process.env.KUBERNETES_SERVICE_HOST || 'kubernetes.default.svc';
const PORT = process.env.KUBERNETES_SERVICE_PORT || '443';
const SW_IMAGE = process.env.SEAWEEDFS_IMAGE || 'chrislusf/seaweedfs:4.33';
const SW_MASTER = process.env.SEAWEEDFS_MASTER || `falcone-seaweedfs-master.${NS}:9333`;

function k8s(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      host: HOST, port: PORT, path, method, ca: CA,
      headers: {
        authorization: `Bearer ${readToken()}`, accept: 'application/json',
        ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let buf = ''; res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) { const e = new Error(`k8s ${method} ${path} -> ${res.statusCode}: ${buf.slice(0, 300)}`); e.statusCode = res.statusCode; return reject(e); }
        try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// DNS-/identity-safe per-WORKSPACE identity name (mirrors the product's legacy
// deriveWorkspaceStorageIdentityName: falcone-ws-<workspaceId>). Pure.
//
// RETAINED for backward compatibility only — the per-workspace name was the #673 root
// cause (one identity accumulated every bucket grant), so the issuer NO LONGER uses it.
// The issuer keys on bucketIdentityName(bucket) instead. Kept exported in case a caller
// still references it; do not seed identities with it.
export function workspaceIdentityName(workspaceId) {
  const id = String(workspaceId ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return `falcone-ws-${id}`.slice(0, 63);
}

// Deterministic, DNS-/identity-safe PER-BUCKET identity name (#673). The physical
// bucket name (`ws-<wsHash12>-<nameFrag40>` from storage-handlers deriveBucketName) is
// already globally unique and embeds the workspace, so it is the natural key: same
// bucket -> same identity (idempotent re-provision); distinct buckets -> distinct
// identities (no accumulation). We hash it to a fixed-length, always-DNS-safe label so
// the result is <=63 chars regardless of the (already bounded) bucket name. Pure.
//
// Shape: `falcone-s3-<sha256(bucket).slice(0,40)>` (11 + 40 = 51 chars, well under 63).
export function bucketIdentityName(bucket) {
  const b = String(bucket ?? '').trim();
  if (!b) throw new Error('bucketIdentityName requires a bucket');
  const hash = createHash('sha256').update(`bucket:${b}`).digest('hex').slice(0, 40);
  return `falcone-s3-${hash}`;
}

// Generate a fresh access/secret key pair for a bucket identity. Pure (injectable rand).
export function generateStorageKeys(rand = randomBytes) {
  return { accessKey: `flcs3${rand(12).toString('hex')}`, secretKey: rand(24).toString('hex') };
}

// Build the one-shot seed Job manifest (pure, testable). The identity is keyed on the
// physical bucket and scoped to ONLY `bucket` with `actions` — never a wildcard/global
// grant, so it cannot reach another bucket (intra- or cross-workspace). The seed first
// DELETEs any prior identity of the same name then APPLYs a single fresh key, so a
// re-provision is a clean rotate: keys/grants never accumulate (#673). `s3.configure
// -delete -apply` is the canonical delete-and-live-reload (matches the shippable
// services/adapters/src/seaweedfs-iam-client.mjs delete path).
export function seedJobManifest({ ns, name, image = SW_IMAGE, master = SW_MASTER, identityName, accessKey, secretKey, bucket, actions = ['Read', 'Write', 'List'] }) {
  if (!bucket) throw new Error('seedJobManifest requires a bucket (refusing an unscoped identity)');
  // Delete any prior identity of this name (idempotent — a missing identity is fine),
  // then apply exactly one key scoped to the one bucket. `|| true` on the delete keeps
  // a first-ever provision (nothing to delete) from failing the Job.
  const seedCmd = [
    'printf \'s3.configure -delete -apply -user %s\\n\' "$ID_NAME" | weed shell -master="$SW_MASTER" || true;',
    'printf \'s3.configure -apply -user %s -access_key %s -secret_key %s -buckets %s -actions %s\\n\'',
    '"$ID_NAME" "$AK" "$SK" "$BUCKET" "$ACTIONS"',
    '| weed shell -master="$SW_MASTER"',
    '| grep -q "$ID_NAME"',
  ].join(' ');
  return {
    apiVersion: 'batch/v1', kind: 'Job',
    metadata: { name, namespace: ns, labels: { app: 'falcone-ws-identity-seed' } },
    spec: {
      backoffLimit: 4, ttlSecondsAfterFinished: 300,
      template: {
        metadata: { labels: { 'app.kubernetes.io/name': 'seaweedfs', role: 'ws-identity-seed' } },
        spec: {
          restartPolicy: 'Never',
          containers: [{
            name: 'seed', image, imagePullPolicy: 'IfNotPresent',
            env: [
              { name: 'ID_NAME', value: identityName }, { name: 'AK', value: accessKey },
              { name: 'SK', value: secretKey }, { name: 'BUCKET', value: bucket },
              { name: 'ACTIONS', value: actions.join(',') }, { name: 'SW_MASTER', value: master },
            ],
            command: ['/bin/sh', '-ec', seedCmd],
          }],
        },
      },
    },
  };
}

// Build the one-shot REVOKE Job manifest (pure, testable). Runs `s3.configure -delete
// -apply -user <identityName>` so the identity AND all of its keys are removed and the
// gateway reloads live — the prior access key no longer authenticates (#673). No keys
// are needed (delete by name only); fail-closed on a missing identity name.
export function revokeJobManifest({ ns, name, image = SW_IMAGE, master = SW_MASTER, identityName }) {
  if (!identityName) throw new Error('revokeJobManifest requires an identityName (nothing to revoke)');
  const revokeCmd = [
    'printf \'s3.configure -delete -apply -user %s\\n\' "$ID_NAME"',
    '| weed shell -master="$SW_MASTER"',
  ].join(' ');
  return {
    apiVersion: 'batch/v1', kind: 'Job',
    metadata: { name, namespace: ns, labels: { app: 'falcone-ws-identity-revoke' } },
    spec: {
      backoffLimit: 4, ttlSecondsAfterFinished: 300,
      template: {
        metadata: { labels: { 'app.kubernetes.io/name': 'seaweedfs', role: 'ws-identity-revoke' } },
        spec: {
          restartPolicy: 'Never',
          containers: [{
            name: 'revoke', image, imagePullPolicy: 'IfNotPresent',
            env: [
              { name: 'ID_NAME', value: identityName }, { name: 'SW_MASTER', value: master },
            ],
            command: ['/bin/sh', '-ec', revokeCmd],
          }],
        },
      },
    },
  };
}

async function waitJobComplete(ns, name, { client, attempts = 30, delayMs = 2000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  for (let i = 0; i < attempts; i++) {
    const job = await client('GET', `/apis/batch/v1/namespaces/${ns}/jobs/${name}`).catch(() => null);
    const s = job?.status ?? {};
    if (Number(s.succeeded) >= 1) return true;
    if (Number(s.failed) >= (job?.spec?.backoffLimit ?? 4) + 1) throw new Error(`seed Job ${name} failed`);
    await sleep(delayMs);
  }
  throw new Error(`seed Job ${name} did not complete in time`);
}

// Build a DNS-safe k8s Job name from a stable prefix + the bucket-identity hash (so two
// concurrent provisions of distinct buckets never collide on a Job name) + a random
// suffix (so a re-provision of the SAME bucket gets a fresh Job rather than a name clash
// with a not-yet-GC'd prior Job). Bounded to 63 chars.
function jobNameFor(prefix, identityName, suffix) {
  const idFrag = String(identityName).replace(/[^a-z0-9-]/g, '-').slice(-24);
  return `${prefix}-${idFrag}-${suffix}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
}

/**
 * Issue a per-BUCKET SeaweedFS identity scoped to `bucket`. Deletes any prior identity
 * of the same (bucket-derived) name then applies exactly one fresh key (delete-then-
 * apply in one Job), so a (re)provision yields EXACTLY ONE active key scoped to ONLY
 * that bucket — keys/grants never accumulate (#673). Waits for the Job and returns the
 * one-time credential. Injectable client/keys for tests. `workspaceId` is accepted for
 * backward-compatible call sites but no longer drives the identity name; the bucket
 * does.
 * @returns {Promise<{identityName:string, bucket:string, accessKey:string, secretKey:string, actions:string[]}>}
 */
export async function issueBucketIdentity({ bucket, workspaceId, actions = ['Read', 'Write', 'List'], ns = NS, master = SW_MASTER, image = SW_IMAGE, client = k8s, keys, jobSuffix, wait = true }) {
  if (!bucket) throw new Error('issueBucketIdentity requires a bucket');
  const identityName = bucketIdentityName(bucket);
  const cred = keys ?? generateStorageKeys();
  const suffix = (jobSuffix ?? randomBytes(4).toString('hex')).toLowerCase();
  const jobName = jobNameFor('bktid', identityName, suffix);
  const manifest = seedJobManifest({ ns, name: jobName, image, master, identityName, accessKey: cred.accessKey, secretKey: cred.secretKey, bucket, actions });
  await client('POST', `/apis/batch/v1/namespaces/${ns}/jobs`, manifest);
  if (wait) await waitJobComplete(ns, jobName, { client });
  return { identityName, bucket, accessKey: cred.accessKey, secretKey: cred.secretKey, actions };
}

/**
 * Backward-compatible alias kept for existing call sites/tests. Now routes through the
 * per-BUCKET issuer (the per-workspace name caused the #673 accumulation), so the
 * returned `identityName` is the bucket-derived name.
 */
export async function issueWorkspaceIdentity(opts = {}) {
  return issueBucketIdentity(opts);
}

/**
 * Revoke (delete) the SeaweedFS identity for `bucket` so the identity AND all its keys
 * are removed and the prior access key is rejected (#673). Runs a one-shot delete Job.
 * Injectable client for tests. Returns the deleted identity name.
 * @returns {Promise<{identityName:string, bucket:string, revoked:true}>}
 */
export async function revokeBucketIdentity({ bucket, ns = NS, master = SW_MASTER, image = SW_IMAGE, client = k8s, jobSuffix, wait = true }) {
  if (!bucket) throw new Error('revokeBucketIdentity requires a bucket');
  const identityName = bucketIdentityName(bucket);
  const suffix = (jobSuffix ?? randomBytes(4).toString('hex')).toLowerCase();
  const jobName = jobNameFor('bktrm', identityName, suffix);
  const manifest = revokeJobManifest({ ns, name: jobName, image, master, identityName });
  await client('POST', `/apis/batch/v1/namespaces/${ns}/jobs`, manifest);
  if (wait) await waitJobComplete(ns, jobName, { client });
  return { identityName, bucket, revoked: true };
}
