// Per-workspace SeaweedFS identity issuance for the kind control-plane (#553).
//
// In filer-mode (chart: seaweedfs.s3.enableAuth=false + -iam.readOnly=false), the s3
// gateway loads IAM identities from the filer and picks up changes dynamically. A
// per-workspace identity scoped to ONLY its own bucket is onboarded via
// `weed shell s3.configure -apply` — so a tenant gets a credential that can access its
// own bucket and is AccessDenied on every other tenant's bucket (verified live
// 2026-06-18), instead of everyone sharing the broad admin/master key.
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
import { randomBytes } from 'node:crypto';

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

// DNS-/identity-safe per-workspace identity name (mirrors the product's
// deriveWorkspaceStorageIdentityName: falcone-ws-<workspaceId>). Pure.
export function workspaceIdentityName(workspaceId) {
  const id = String(workspaceId ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return `falcone-ws-${id}`.slice(0, 63);
}

// Generate a fresh access/secret key pair for a workspace identity. Pure (injectable rand).
export function generateStorageKeys(rand = randomBytes) {
  return { accessKey: `flcs3${rand(12).toString('hex')}`, secretKey: rand(24).toString('hex') };
}

// Build the one-shot seed Job manifest (pure, testable). The seed identity is scoped
// to ONLY `bucket` with `actions` — never a wildcard/global grant, so it cannot reach
// another tenant's bucket.
export function seedJobManifest({ ns, name, image = SW_IMAGE, master = SW_MASTER, identityName, accessKey, secretKey, bucket, actions = ['Read', 'Write', 'List'] }) {
  if (!bucket) throw new Error('seedJobManifest requires a bucket (refusing an unscoped identity)');
  const seedCmd = [
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

/**
 * Issue a per-workspace SeaweedFS identity scoped to `bucket`. Creates the seed Job,
 * waits for it, and returns the one-time credential. Injectable client/keys for tests.
 * @returns {Promise<{identityName:string, bucket:string, accessKey:string, secretKey:string, actions:string[]}>}
 */
export async function issueWorkspaceIdentity({ workspaceId, bucket, actions = ['Read', 'Write', 'List'], ns = NS, master = SW_MASTER, image = SW_IMAGE, client = k8s, keys, jobSuffix, wait = true }) {
  if (!bucket) throw new Error('issueWorkspaceIdentity requires a bucket');
  const identityName = workspaceIdentityName(workspaceId);
  const cred = keys ?? generateStorageKeys();
  const suffix = (jobSuffix ?? randomBytes(4).toString('hex')).toLowerCase();
  const jobName = `wsid-${String(workspaceId).slice(0, 8)}-${suffix}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 63);
  const manifest = seedJobManifest({ ns, name: jobName, image, master, identityName, accessKey: cred.accessKey, secretKey: cred.secretKey, bucket, actions });
  await client('POST', `/apis/batch/v1/namespaces/${ns}/jobs`, manifest);
  if (wait) await waitJobComplete(ns, jobName, { client });
  return { identityName, bucket, accessKey: cred.accessKey, secretKey: cred.secretKey, actions };
}
