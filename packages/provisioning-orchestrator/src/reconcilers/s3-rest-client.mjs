/**
 * Minimal SigV4 S3 REST client (path-style) for the SeaweedFS reconciliation CLI.
 *
 * Pure node:crypto + fetch — no AWS SDK dependency, mirroring the kind-runtime
 * signer in apps/control-plane/storage-handlers.mjs. Exposes the s3Api
 * shape the reconciler consumes, and supports a per-request credential override
 * so cross-tenant isolation probes (verifyIsolation) can sign as another tenant.
 *
 * Region scope is irrelevant on the SeaweedFS gateway (adr-spike: `auto` ==
 * `us-east-1`), but is signed for correctness.
 *
 * @module reconcilers/s3-rest-client
 */

import crypto from 'node:crypto';

const EMPTY_SHA = crypto.createHash('sha256').update('').digest('hex');
const sha256hex = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const escapeXml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function amzDates() {
  const d = new Date();
  const amzDate = d.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

const oneTag = (xml, tag) => {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : null;
};
const allTags = (xml, tag) => {
  const out = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
};

/** Serialize a JS config object into S3 XML, pluralizing the known AWS roots. */
function configToXml(rootTag, value) {
  // Map array-valued container fields to their AWS singular element tag.
  const singular = { Rules: 'Rule', CORSRules: 'CORSRule', Statement: 'Statement' };
  const emit = (tag, v) => {
    if (Array.isArray(v)) return v.map((item) => emit(tag, item)).join('');
    if (v !== null && typeof v === 'object') {
      const inner = Object.entries(v)
        .map(([k, kv]) => {
          if (Array.isArray(kv) && singular[k]) return kv.map((item) => emit(singular[k], item)).join('');
          return emit(k, kv);
        })
        .join('');
      return `<${tag}>${inner}</${tag}>`;
    }
    return `<${tag}>${escapeXml(v)}</${tag}>`;
  };
  return emit(rootTag, value);
}

export function createSeaweedFSClient(config = {}) {
  const endpoint = String(config.endpoint ?? '').replace(/\/+$/, '');
  const region = config.region ?? 'us-east-1';
  const defaultCred = { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey };

  async function s3(method, path, { query = {}, headers = {}, body, credential } = {}) {
    const cred = credential ?? defaultCred;
    const url = new URL(endpoint);
    const host = url.host;
    const payloadHash = body ? sha256hex(body) : EMPTY_SHA;
    const { amzDate, dateStamp } = amzDates();

    const canonicalUri = path.split('/').map((seg, i) => (i === 0 ? seg : enc(seg))).join('/') || '/';
    const canonicalQuery = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(String(query[k]))}`).join('&');

    const hdrs = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
    const signedHeaders = Object.keys(hdrs).sort().join(';');
    const canonicalHeaders = Object.keys(hdrs).sort().map((k) => `${k}:${hdrs[k]}\n`).join('');
    const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');

    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
    const signingKey = hmac(hmac(hmac(hmac('AWS4' + cred.secretAccessKey, dateStamp), region), 's3'), 'aws4_request');
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${cred.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const qs = canonicalQuery ? `?${canonicalQuery}` : '';
    const res = await fetch(`${endpoint}${canonicalUri}${qs}`, {
      method,
      headers: { ...headers, authorization, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate },
      body: body ?? undefined,
    });
    const text = method === 'HEAD' ? '' : await res.text();
    if (!res.ok) {
      const e = new Error(`s3 ${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
      e.statusCode = res.status;
      e.body = text;
      throw e;
    }
    return { status: res.status, headers: res.headers, text };
  }

  return {
    async listBuckets() {
      const { text } = await s3('GET', '/');
      return { Buckets: allTags(text, 'Bucket').map((b) => ({ Name: oneTag(b, 'Name') })) };
    },
    async headBucket(name, opts = {}) {
      return s3('HEAD', `/${name}`, { credential: opts.credential });
    },
    async createBucket(name) {
      try {
        return await s3('PUT', `/${name}`);
      } catch (e) {
        if (/BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(e.body ?? '')) return { status: 200 };
        throw e;
      }
    },
    async putBucketPolicy(name, policy) {
      return s3('PUT', `/${name}`, { query: { policy: '' }, body: JSON.stringify(policy), headers: { 'content-type': 'application/json' } });
    },
    async putBucketVersioning(name, configuration) {
      const status = configuration?.Status ?? (configuration === 'Enabled' ? 'Enabled' : 'Suspended');
      const body = `<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Status>${escapeXml(status)}</Status></VersioningConfiguration>`;
      return s3('PUT', `/${name}`, { query: { versioning: '' }, body, headers: { 'content-type': 'application/xml' } });
    },
    async putBucketLifecycleConfiguration(name, configuration) {
      const body = configToXml('LifecycleConfiguration', configuration);
      return s3('PUT', `/${name}`, { query: { lifecycle: '' }, body, headers: { 'content-type': 'application/xml' } });
    },
    async putBucketCors(name, configuration) {
      const payload = Array.isArray(configuration) ? { CORSRules: configuration } : configuration;
      const body = configToXml('CORSConfiguration', payload);
      return s3('PUT', `/${name}`, { query: { cors: '' }, body, headers: { 'content-type': 'application/xml' } });
    },
  };
}
