#!/usr/bin/env node
// Document-parity checker for the MongoDB -> FerretDB v2 + DocumentDB migration
// (change add-ferretdb-migration-validation, tasks 2.1-2.5).
//
// Consumes the migration manifest produced by add-ferretdb-data-migration-runbook
// (tools/migration/ferretdb/snapshot.sh, emitted as `<snapshot-dir>/post-<ts>.json`):
// an array of
//   { db, collection, documentCount, checksum, indexes:[{name,key,unique}] }
// where `checksum` is an ENGINE-AGNOSTIC sha256 over the collection's documents sorted by
// `_id`, each canonicalised (keys recursively sorted; BSON number wrappers normalised to
// their numeric value) so a MongoDB source and its FerretDB target yield the SAME digest for
// identical logical data, despite int32/int64/double storage and field-order differences.
// OQ1 RESOLVED (design D2): the manifest uses document count + content checksum per
// (db, collection) — NOT ObjectId ranges. `digestDocuments` below reproduces snapshot.sh's
// algorithm byte-for-byte so the live recomputation matches the recorded value.
//
// For each manifest namespace it reads the live FerretDB/DocumentDB endpoint, recomputes the
// documentCount + checksum, and compares (design D2: the manifest is the source of truth — it
// captures the migration snapshot, so re-reading MongoDB at cutover time cannot raise false
// positives from post-snapshot writes). Reports missing namespaces, count mismatches, and
// checksum mismatches as a structured JSON report; exits non-zero on any discrepancy not
// present in a reviewed exception list (design D4, fail-closed).
//
// Parity is namespace-level and therefore spans ALL tenants sharing a collection (Falcone's
// document store is shared-collection with a `tenantId` field, not db-per-tenant). Per-tenant
// seeding (tenants A/B) is the smoke runner's job (tasks 1.3/1.4); the parity gate consumes
// the migration manifest as-is.
//
// Modes:
//   --manifest <file>                manifest-driven (authoritative; design D2)
//   --live-diff --source-uri <uri>   fallback: snapshot the live MongoDB source directly and
//                                    diff it against the destination (design D2 alternative)
//   --exceptions <file>              newline list of "db.collection" entries to accept
//   --uri <uri>                      destination FerretDB gateway URI (default: FERRETDB_URI
//                                    || MONGO_URI). OQ2 RESOLVED: the FerretDB gateway listens
//                                    on the same host port 57017 as the replaced mongo:7, so it
//                                    does not collide; point --uri / MONGO_URI there.

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MongoClient, BSON } from 'mongodb';

const { EJSON } = BSON;

// Engine-agnostic canonical form — mirrors tools/migration/ferretdb/snapshot.sh::canon:
// recursively sort object keys; normalise BSON number wrappers to a plain number so int32 /
// int64 / double storage differences between MongoDB and FerretDB do not change the digest.
export function canon(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(canon);
  for (const nk of ['$numberInt', '$numberLong', '$numberDouble', '$numberDecimal']) {
    if (Object.prototype.hasOwnProperty.call(v, nk)) return Number(v[nk]);
  }
  const out = {};
  for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
  return out;
}

// sha256 over the documents (which MUST already be sorted by `_id` ascending, as snapshot.sh
// does via `.sort({ _id: 1 })`), each serialised to canonical EJSON. Same digest as snapshot.sh.
export function digestDocuments(documents) {
  const h = crypto.createHash('sha256');
  for (const doc of documents) h.update(JSON.stringify(canon(EJSON.serialize(doc))));
  return h.digest('hex');
}

// Pure, injectable parity comparison. `getLiveState(entry) -> { documentCount, checksum } | null`
// returns null when the namespace is absent from the destination (a missing collection).
export async function checkParity({ manifest, getLiveState, exceptions = new Set() }) {
  const report = { namespaces: [], missing: [], mismatched: [], acceptedExceptions: [], ok: false };

  for (const entry of manifest) {
    const ref = `${entry.db}.${entry.collection}`;
    const live = await getLiveState(entry);

    if (!live) {
      if (exceptions.has(ref)) report.acceptedExceptions.push({ ref, kind: 'missing' });
      else report.missing.push(ref);
      report.namespaces.push({ ref, expected: entry.documentCount, live: null });
      continue;
    }

    const countMatch = live.documentCount === entry.documentCount;
    const checksumMatch = live.checksum === entry.checksum;
    report.namespaces.push({ ref, expected: entry.documentCount, live: live.documentCount, checksumMatch });

    if (countMatch && checksumMatch) continue;

    const mismatch = { ref };
    if (!countMatch) { mismatch.expectedCount = entry.documentCount; mismatch.actualCount = live.documentCount; }
    if (!checksumMatch) { mismatch.expectedChecksum = entry.checksum; mismatch.actualChecksum = live.checksum; }
    if (exceptions.has(ref)) report.acceptedExceptions.push({ ...mismatch, kind: 'mismatch' });
    else report.mismatched.push(mismatch);
  }

  report.ok = report.missing.length === 0 && report.mismatched.length === 0;
  return report;
}

function parseArgs(argv) {
  const a = { manifest: null, exceptions: null, uri: null, liveDiff: false, sourceUri: null, dbs: 'all' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--manifest') a.manifest = argv[++i];
    else if (argv[i] === '--exceptions') a.exceptions = argv[++i];
    else if (argv[i] === '--uri') a.uri = argv[++i];
    else if (argv[i] === '--live-diff') a.liveDiff = true;
    else if (argv[i] === '--source-uri') a.sourceUri = argv[++i];
    else if (argv[i] === '--dbs') a.dbs = argv[++i];
  }
  return a;
}

function loadExceptions(file) {
  if (!file) return new Set();
  try { return new Set(readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))); }
  catch { return new Set(); }
}

/* c8 ignore start — main-guard: real MongoClient against the live FerretDB endpoint, run via run-ferretdb-validation.sh. */

// Read one namespace's live state via the real driver, reproducing snapshot.sh exactly.
async function readLiveState(client, entry) {
  const db = client.db(entry.db);
  const exists = (await db.listCollections({ name: entry.collection }).toArray()).length > 0;
  if (!exists) return null;
  const documents = await db.collection(entry.collection).find().sort({ _id: 1 }).toArray();
  return { documentCount: documents.length, checksum: digestDocuments(documents) };
}

// Build a manifest live from the MongoDB source (fallback live-diff mode; design D2 alternative).
async function snapshotSource(sourceUri, dbsArg) {
  const skip = new Set(['admin', 'local', 'config']);
  const client = new MongoClient(sourceUri);
  await client.connect();
  try {
    let dbNames;
    if (dbsArg && dbsArg !== 'all') dbNames = dbsArg.split(',').map((s) => s.trim()).filter(Boolean);
    else dbNames = (await client.db().admin().listDatabases()).databases.map((d) => d.name).filter((n) => !skip.has(n));
    const manifest = [];
    for (const dbn of dbNames.sort()) {
      const db = client.db(dbn);
      const colls = (await db.listCollections().toArray()).map((c) => c.name).sort();
      for (const collection of colls) {
        const documents = await db.collection(collection).find().sort({ _id: 1 }).toArray();
        manifest.push({ db: dbn, collection, documentCount: documents.length, checksum: digestDocuments(documents) });
      }
    }
    return manifest;
  } finally {
    await client.close().catch(() => {});
  }
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const exceptions = loadExceptions(a.exceptions);
  const destUri = a.uri ?? process.env.FERRETDB_URI ?? process.env.MONGO_URI;
  if (!destUri) { console.error('FATAL: set --uri or FERRETDB_URI / MONGO_URI (FerretDB gateway, e.g. mongodb://falcone:falcone@localhost:57017/)'); process.exit(2); }

  let manifest;
  if (a.manifest) {
    manifest = JSON.parse(readFileSync(a.manifest, 'utf8'));
  } else if (a.liveDiff && a.sourceUri) {
    manifest = await snapshotSource(a.sourceUri, a.dbs);
  } else {
    console.error('FATAL: provide --manifest <post-<ts>.json> or --live-diff --source-uri <mongodb-uri>'); process.exit(2);
  }

  const client = new MongoClient(destUri);
  await client.connect();
  let report;
  try {
    report = await checkParity({ manifest, getLiveState: (entry) => readLiveState(client, entry), exceptions });
  } finally {
    await client.close().catch(() => {});
  }

  console.log(JSON.stringify(report, null, 2));
  if (report.ok) {
    console.error(`PASS: document parity OK across ${report.namespaces.length} namespace(s)` + (report.acceptedExceptions.length ? ` (${report.acceptedExceptions.length} reviewed exception(s))` : ''));
    process.exit(0);
  }
  console.error(`FAIL: ${report.missing.length} missing namespace(s), ${report.mismatched.length} mismatch(es)`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
}
/* c8 ignore stop */
