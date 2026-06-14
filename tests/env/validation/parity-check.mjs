#!/usr/bin/env node
// Object-parity checker for the SeaweedFS migration
// (change add-seaweedfs-migration-validation, tasks 2.1-2.5).
//
// Compares the migration manifest (the snapshot produced by
// add-seaweedfs-data-migration-runbook: `[{bucket,objectCount,objects:[{key,etag,
// size}]}]`) against the live SeaweedFS endpoint (`S3_ENDPOINT`), per bucket, on
// object count + ETag. Reports missing keys and ETag mismatches as a structured
// JSON report and exits non-zero on any discrepancy not present in a reviewed
// exception list (design D4, fail-closed). OQ1 resolved: the manifest uses ETag.
//
// Modes:
//   --manifest <file>            manifest-driven (authoritative; design D2)
//   --live-diff --source-endpoint <ep>   fallback: list MinIO vs SeaweedFS directly
//   --exceptions <file>          newline list of "bucket/key" entries to accept
//
// Credentials: AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY (or S3_ACCESS_KEY/
// S3_SECRET_KEY) for the destination; SRC_* for the source in live-diff mode.
// Self-contained SigV4 (node:crypto + fetch, no SDK), mirroring the kind runtime
// signer in deploy/kind/control-plane/storage-handlers.mjs.

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const sha256hex = (d) => crypto.createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const EMPTY_SHA = sha256hex('');

function amzDates() {
  const d = new Date();
  const amzDate = d.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

// Signed S3 GET (path-style). query is an object of query params.
async function s3Get(endpoint, path, { query = {}, creds, region = 'us-east-1' }) {
  const url = new URL(endpoint.replace(/\/+$/, ''));
  const host = url.host;
  const { amzDate, dateStamp } = amzDates();
  const canonicalUri = path.split('/').map((seg, i) => (i === 0 ? seg : enc(seg))).join('/') || '/';
  const canonicalQuery = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(String(query[k]))}`).join('&');
  const hdrs = { host, 'x-amz-content-sha256': EMPTY_SHA, 'x-amz-date': amzDate };
  const signedHeaders = Object.keys(hdrs).sort().join(';');
  const canonicalHeaders = Object.keys(hdrs).sort().map((k) => `${k}:${hdrs[k]}\n`).join('');
  const canonicalRequest = ['GET', canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, EMPTY_SHA].join('\n');
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac('AWS4' + creds.secretKey, dateStamp), region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const qs = canonicalQuery ? `?${canonicalQuery}` : '';
  const res = await fetch(`${url.origin}${canonicalUri}${qs}`, {
    headers: { authorization, 'x-amz-content-sha256': EMPTY_SHA, 'x-amz-date': amzDate },
  });
  const text = await res.text();
  if (!res.ok) { const e = new Error(`s3 GET ${path} -> ${res.status}: ${text.slice(0, 160)}`); e.statusCode = res.status; throw e; }
  return text;
}

// Minimal, entity-tolerant XML extraction (same shape as storage-handlers.mjs).
const decodeEnt = (s) => s == null ? null : s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;|&#34;|&#x22;/gi, '"')
  .replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, '&');
const oneTag = (xml, t) => { const m = xml.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return m ? decodeEnt(m[1]) : null; };
const allTags = (xml, t) => { const out = []; const re = new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, 'g'); let m; while ((m = re.exec(xml))) out.push(m[1]); return out; };

// List every object {key, etag, size} in a bucket (ListObjectsV2 + pagination).
export async function listBucketObjects(endpoint, bucket, creds) {
  const objects = [];
  let token;
  do {
    const query = { 'list-type': '2', 'max-keys': '1000' };
    if (token) query['continuation-token'] = token;
    const xml = await s3Get(endpoint, `/${bucket}`, { query, creds });
    for (const c of allTags(xml, 'Contents')) {
      objects.push({
        key: oneTag(c, 'Key'),
        etag: (oneTag(c, 'ETag') ?? '').replace(/"/g, ''),
        size: Number(oneTag(c, 'Size') ?? 0),
      });
    }
    token = oneTag(xml, 'IsTruncated') === 'true' ? oneTag(xml, 'NextContinuationToken') : null;
  } while (token);
  return objects.sort((a, b) => a.key.localeCompare(b.key));
}

function credsFrom(prefix) {
  const ak = process.env[`${prefix}ACCESS_KEY_ID`] ?? process.env[`${prefix}ACCESS_KEY`];
  const sk = process.env[`${prefix}SECRET_ACCESS_KEY`] ?? process.env[`${prefix}SECRET_KEY`];
  return ak && sk ? { accessKey: ak, secretKey: sk } : null;
}

function parseArgs(argv) {
  const a = { manifest: null, exceptions: null, endpoint: process.env.S3_ENDPOINT, liveDiff: false, sourceEndpoint: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--manifest') a.manifest = argv[++i];
    else if (argv[i] === '--exceptions') a.exceptions = argv[++i];
    else if (argv[i] === '--endpoint') a.endpoint = argv[++i];
    else if (argv[i] === '--live-diff') a.liveDiff = true;
    else if (argv[i] === '--source-endpoint') a.sourceEndpoint = argv[++i];
  }
  return a;
}

function loadExceptions(file) {
  if (!file) return new Set();
  try { return new Set(readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))); }
  catch { return new Set(); }
}

// Compare an expected bucket-list (manifest) against the live destination.
export async function checkParity({ manifest, endpoint, creds, exceptions = new Set(), list = listBucketObjects }) {
  const report = { buckets: [], missing: [], mismatched: [], extra: [], acceptedExceptions: [] };
  for (const entry of manifest) {
    const live = await list(endpoint, entry.bucket, creds);
    const liveMap = new Map(live.map((o) => [o.key, o]));
    const expMap = new Map((entry.objects ?? []).map((o) => [o.key, o]));
    for (const [key, exp] of expMap) {
      const ref = `${entry.bucket}/${key}`;
      const got = liveMap.get(key);
      if (!got) {
        if (exceptions.has(ref)) report.acceptedExceptions.push({ ref, kind: 'missing' });
        else report.missing.push(ref);
      } else if (got.etag !== exp.etag) {
        if (exceptions.has(ref)) report.acceptedExceptions.push({ ref, kind: 'etag', expected: exp.etag, actual: got.etag });
        else report.mismatched.push({ ref, expected: exp.etag, actual: got.etag });
      }
    }
    for (const key of liveMap.keys()) if (!expMap.has(key)) report.extra.push(`${entry.bucket}/${key}`);
    report.buckets.push({ bucket: entry.bucket, expected: expMap.size, live: liveMap.size });
  }
  report.ok = report.missing.length === 0 && report.mismatched.length === 0;
  return report;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const exceptions = loadExceptions(a.exceptions);
  const destCreds = credsFrom('AWS_') ?? credsFrom('S3_');
  if (!a.endpoint || !destCreds) { console.error('FATAL: set S3_ENDPOINT + S3_ACCESS_KEY/S3_SECRET_KEY (destination)'); process.exit(2); }

  let manifest;
  if (a.manifest) {
    manifest = JSON.parse(readFileSync(a.manifest, 'utf8'));
  } else if (a.liveDiff && a.sourceEndpoint) {
    // Fallback (design D2 alternative): build the manifest live from the source.
    const srcCreds = credsFrom('SRC_') ?? destCreds;
    const names = allTags(await s3Get(a.sourceEndpoint, '/', { creds: srcCreds }), 'Bucket').map((b) => oneTag(b, 'Name'));
    manifest = [];
    for (const bucket of names) manifest.push({ bucket, objects: await listBucketObjects(a.sourceEndpoint, bucket, srcCreds) });
  } else {
    console.error('FATAL: provide --manifest <file> or --live-diff --source-endpoint <ep>'); process.exit(2);
  }

  const report = await checkParity({ manifest, endpoint: a.endpoint, creds: destCreds, exceptions });
  console.log(JSON.stringify(report, null, 2));
  if (report.ok) {
    console.error(`PASS: parity OK across ${report.buckets.length} bucket(s)` + (report.acceptedExceptions.length ? ` (${report.acceptedExceptions.length} reviewed exception(s))` : ''));
    process.exit(0);
  }
  console.error(`FAIL: ${report.missing.length} missing, ${report.mismatched.length} mismatched`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
}
