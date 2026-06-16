// Black-box artifacts/contract suite for change add-ferretdb-rollback-plan (#463).
//
// This is an infrastructure/ops change: its public surface is the committed rollback runbook
// + the two helper scripts under tools/migration/ferretdb/, plus the chart retention comments.
// These tests assert the artifacts exist and encode the CODE-GROUNDED, post-#460 procedure —
// most importantly that the realtime/CDC rollback REDEPLOYS the pre-#460 change-stream image
// rather than relying on a MONGO_URI re-point (the premise corrected during reconciliation,
// because #460 removed collection.watch() from realtime-executor.mjs / ChangeStreamWatcher.mjs).
//
// bbx-fdb-rb-A  runbook exists with the ordered checklist + two-plane model
// bbx-fdb-rb-B  realtime rollback = redeploy pre-#460 image, NOT a MONGO_URI re-point
// bbx-fdb-rb-C  point-of-no-return + dual-PVC retention + ENGINE-FIRST are documented
// bbx-fdb-rb-D  delta-back is best-effort idempotent _id UPSERT (not change-stream/oplog)
// bbx-fdb-rb-E  change streams are never verified against FerretDB
// bbx-fdb-rb-F  helper scripts exist, are executable, and parse (bash -n) with a usage guard
// bbx-fdb-rb-G  chart mongodb stanza carries the read-only retention + PVC-keep comments

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { evaluateGate } from '../../tools/migration/ferretdb/rollback-mongo-check.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');
const RUNBOOK = 'tools/migration/ferretdb/ROLLBACK-RUNBOOK.md';
const DELTA_BACK = 'tools/migration/ferretdb/rollback-delta-back.sh';
const VALIDATE = 'tools/migration/ferretdb/rollback-validate.sh';

test('bbx-fdb-rb-A: rollback runbook exists with the ordered checklist and two-plane model', () => {
  const md = read(RUNBOOK);
  assert.match(md, /freeze writes/i);
  assert.match(md, /MONGO_URI/);
  // The data-API plane is a config-only re-point; the realtime plane is separate.
  assert.match(md, /data[- ]API/i);
  assert.match(md, /realtime/i);
  // Ordered steps 1..7 are present.
  for (const n of [1, 2, 3, 4, 5, 6, 7]) assert.ok(md.includes(`${n}.`) || md.includes(`Step ${n}`), `step ${n} present`);
});

test('bbx-fdb-rb-B: realtime rollback redeploys the pre-#460 image, NOT a MONGO_URI re-point', () => {
  const md = read(RUNBOOK);
  assert.match(md, /pre-#460/);
  assert.match(md, /collection\.watch\(\)/);
  assert.match(md, /redeploy/i);
  // The corrected premise must be explicit: a MONGO_URI re-point alone does NOT restore realtime.
  assert.match(md, /re-point alone does not restore realtime/i);
  assert.match(md, /MONGO_URI/);
  // And it must explain WHY: #460 removed the change-stream code / pgoutput re-architecture.
  assert.match(md, /pgoutput/i);
});

test('bbx-fdb-rb-C: point-of-no-return, dual-PVC retention, and ENGINE-FIRST are documented', () => {
  const md = read(RUNBOOK);
  assert.match(md, /point[- ]of[- ]no[- ]return/i);
  assert.match(md, /PVC/);
  assert.match(md, /backup/i); // after PoNR, recovery is via backup restore
  // Two distinct PVCs: MongoDB (anchor) and FerretDB Postgres engine (separate).
  assert.match(md, /engine PVC|DocumentDB.*PVC|Postgres engine/i);
  assert.match(md, /ENGINE-FIRST/i);
  // Window length default 7 days.
  assert.match(md, /7\s*days|N\s*=\s*7|default\s*7/i);
});

test('bbx-fdb-rb-D: delta-back is best-effort idempotent _id UPSERT (not change-stream/oplog)', () => {
  const md = read(RUNBOOK);
  assert.match(md, /best[- ]effort/i);
  assert.match(md, /upsert/i);
  assert.match(md, /_id/);
  assert.match(md, /acknowledge/i); // operator must acknowledge best-effort nature
  // Explicitly rules out change-stream / oplog tailing (unsupported on FerretDB).
  assert.match(md, /oplog/i);
  assert.match(md, /CommandNotSupported\(?115\)?/);
});

test('bbx-fdb-rb-E: change streams are never verified against FerretDB', () => {
  const md = read(RUNBOOK);
  assert.match(md, /not.*verif.*FerretDB|never.*FerretDB|only.*MongoDB/i);
});

test('bbx-fdb-rb-F: helper scripts exist, are executable, and parse with a usage guard', () => {
  for (const rel of [DELTA_BACK, VALIDATE]) {
    const path = resolve(ROOT, rel);
    const mode = statSync(path).mode;
    assert.ok((mode & 0o111) !== 0, `${rel} is executable`);
    // bash -n must succeed (syntax-valid).
    execFileSync('bash', ['-n', path]);
    const sh = read(rel);
    assert.match(sh, /usage:/i, `${rel} prints usage`);
  }
  // delta-back is FerretDB(DocumentDB) -> MongoDB, idempotent _id upsert (reverse of upsert.sh).
  const db = read(DELTA_BACK);
  assert.match(db, /upsert/i);
  assert.match(db, /_id/);
  // validate runs the per-tenant data-API smoke + a MongoDB change-stream delivery check.
  const v = read(VALIDATE);
  assert.match(v, /ROLLBACK_MONGO_URI/);
  assert.match(v, /watch|change[- ]stream/i);
});

test('bbx-fdb-rb-G: chart mongodb stanza carries the read-only retention + PVC-keep comments', () => {
  const values = read('charts/in-falcone/values.yaml');
  // The retention comment block must mention the rollback window and PVC retention.
  assert.match(values, /rollback/i);
  assert.match(values, /resource-policy:\s*keep|do not.*reclaim|retain.*PVC|READ-ONLY/i);
});

test('bbx-fdb-rb-H: MongoDB rollback gate passes only when smoke + isolation + change delivery all hold', () => {
  assert.equal(evaluateGate({ smokeOk: true, crossTenantDenied: true, changeDelivered: true }).ok, true);
  // Each missing condition fails the gate and is named.
  const noChange = evaluateGate({ smokeOk: true, crossTenantDenied: true, changeDelivered: false });
  assert.equal(noChange.ok, false);
  assert.ok(noChange.failures.some((f) => /change-stream/i.test(f)));
  const leak = evaluateGate({ smokeOk: true, crossTenantDenied: false, changeDelivered: true });
  assert.equal(leak.ok, false);
  assert.ok(leak.failures.some((f) => /cross-tenant/i.test(f)));
  assert.equal(evaluateGate({ smokeOk: false, crossTenantDenied: true, changeDelivered: true }).ok, false);
});
