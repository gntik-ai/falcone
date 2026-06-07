// Black-box test suite for change batch-api-key-domain-migration.
// Drives the PUBLIC action entrypoint (`main`) only — fake db injected via params/overrides.
//
// Tests: bbx-apikey-mig-A through bbx-apikey-mig-F
//
// Fake db recognises two query shapes:
//   SELECT — keyset-paginated, filters privilege_domain IS NULL and id > $lastId,
//             returns up to LIMIT rows; records call counts + LIMIT param.
//   UPDATE  — multi-row batched update; parses flattened [id,pd,id,pd,...] params,
//             applies only where privilege_domain is currently null;
//             records update call count.
//
// String ids use zero-padded form ('00000000-0000-0000-0000-000000000001' etc.)
// so lexicographic ordering matches UUID ordering and the nil-UUID sentinel
// '00000000-0000-0000-0000-000000000000' compares less than all seeded ids.

import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../services/provisioning-orchestrator/src/actions/api-key-domain-migration.mjs';
import { TOPICS } from '../../services/provisioning-orchestrator/src/events/privilege-domain-events.mjs';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

// Pad a small integer into a UUID-like string that sorts lexicographically in id order.
function makeId(n) {
  const s = String(n).padStart(12, '0');
  return `00000000-0000-0000-0000-${s}`;
}

// Build a row store (Map<id, row>) with the given count of unclassified rows
// and optional pre-classified rows.
function buildStore({ unclassified = 0, classified = 0, pendingPath = null } = {}) {
  const store = new Map();
  let counter = 1;

  // Classified rows (already have a privilege_domain)
  for (let i = 0; i < classified; i++) {
    const id = makeId(counter++);
    store.set(id, {
      id,
      tenant_id: 'tenant-a',
      workspace_id: 'ws-a',
      last_used_endpoint_category: 'data_access',
      last_used_path: '/v1/collections/x',
      privilege_domain: 'data_access',
    });
  }

  // Unclassified rows that will resolve to structural_admin (via path)
  for (let i = 0; i < unclassified; i++) {
    const id = makeId(counter++);
    const isPending = pendingPath != null && i === 0;
    store.set(id, {
      id,
      tenant_id: 'tenant-a',
      workspace_id: 'ws-a',
      last_used_endpoint_category: null,
      last_used_path: isPending ? pendingPath : '/v1/schemas/x',
      privilege_domain: null,
    });
  }

  return store;
}

// Create a fake db that emulates the two query shapes and tracks calls.
// The fake intentionally supports BOTH the old (unbounded SELECT) and new
// (keyset-paginated SELECT + batched UPDATE) shapes so all tests can drive
// `main` through its public interface only.
function fakeDb(store) {
  const selectCalls = []; // { limit, returnedCount }
  let updateCallCount = 0;

  const db = {
    selectCalls,
    get updateCallCount() { return updateCallCount; },

    async query(sql, params = []) {
      const sqlTrimmed = sql.trim();

      // ---- SELECT shape ----
      if (/^\s*SELECT\b/i.test(sqlTrimmed)) {
        // Determine whether this is a keyset-paginated query (new shape) or
        // an unbounded full-table SELECT (old shape).
        const isKeysetSelect =
          /privilege_domain\s+IS\s+NULL/i.test(sqlTrimmed) &&
          /id\s*>\s*\$1/i.test(sqlTrimmed) &&
          /ORDER\s+BY\s+id\s+ASC/i.test(sqlTrimmed) &&
          /LIMIT\s+\$2/i.test(sqlTrimmed);

        if (isKeysetSelect) {
          const lastId = params[0];
          const limit = params[1];

          // Return rows with privilege_domain == null and id > lastId, sorted, up to limit.
          const eligible = Array.from(store.values())
            .filter(r => r.privilege_domain == null && r.id > lastId)
            .sort((a, b) => a.id < b.id ? -1 : 1)
            .slice(0, limit);

          selectCalls.push({ limit, returnedCount: eligible.length });
          return { rows: eligible };
        }

        // Old unbounded SELECT — return everything (including classified rows).
        // This emulates the current broken behaviour so Scenario A fails.
        const all = Array.from(store.values())
          .sort((a, b) => a.id < b.id ? -1 : 1);
        selectCalls.push({ limit: null, returnedCount: all.length });
        return { rows: all };
      }

      // ---- UPDATE shape ----
      if (/^\s*UPDATE\b/i.test(sqlTrimmed)) {
        updateCallCount += 1;

        // Detect multi-row batched UPDATE (new shape):
        //   UPDATE api_keys AS k SET privilege_domain = v.pd FROM (VALUES ...) AS v(id, pd)
        //   WHERE k.id = v.id AND k.privilege_domain IS NULL
        const isBatchedUpdate =
          /FROM\s*\(\s*VALUES/i.test(sqlTrimmed) &&
          /k\.privilege_domain\s+IS\s+NULL/i.test(sqlTrimmed);

        if (isBatchedUpdate) {
          // params: [id1, pd1, id2, pd2, ...]
          for (let i = 0; i < params.length; i += 2) {
            const id = params[i];
            const pd = params[i + 1];
            const row = store.get(id);
            if (row && row.privilege_domain == null) {
              row.privilege_domain = pd;
            }
          }
          return { rows: [] };
        }

        // Old per-row UPDATE shape: WHERE id = $1 AND privilege_domain IS NULL
        // params: [id, pd]
        const [id, pd] = params;
        const row = store.get(id);
        if (row && row.privilege_domain == null) {
          row.privilege_domain = pd;
        }
        return { rows: [] };
      }

      return { rows: [] };
    },
  };

  return db;
}

// ---------------------------------------------------------------------------
// Scenario A — migration does not fetch already-classified rows at SQL level
// ---------------------------------------------------------------------------
test('bbx-apikey-mig-A: already-classified rows are excluded at the SQL level (WHERE privilege_domain IS NULL)', async () => {
  // 2 already-classified + 1 unclassified
  const store = buildStore({ unclassified: 1, classified: 2 });
  const db = fakeDb(store);

  const result = await main({}, { db });

  assert.equal(result.statusCode, 200, `expected 200, got ${result.statusCode}`);

  // The fixed code must never fetch classified rows — confirmed by checking that
  // every SELECT used the keyset filter (no unbounded SELECT that returns
  // classified rows was issued).
  const hadUnboundedSelect = db.selectCalls.some(c => c.limit === null);
  assert.equal(
    hadUnboundedSelect,
    false,
    'migration must NOT issue an unbounded SELECT (must use WHERE privilege_domain IS NULL with LIMIT)'
  );

  // Only the 1 unclassified row should have been processed.
  // The 2 already-classified rows must be untouched.
  const classifiedAfter = Array.from(store.values()).filter(r => r.privilege_domain != null);
  assert.equal(classifiedAfter.length, 3, 'all 3 rows should end up classified after migration');

  // alreadyClassified key preserved (value 0 since classified rows were never fetched)
  assert.equal(
    result.body.alreadyClassified,
    0,
    'alreadyClassified must be 0 — classified rows are not fetched, so none are counted in app'
  );
});

// ---------------------------------------------------------------------------
// Scenario E — all unclassified rows are classified after migration completes
// ---------------------------------------------------------------------------
test('bbx-apikey-mig-E: all unclassified rows receive a non-null privilege_domain after migration', async () => {
  const store = buildStore({ unclassified: 5, classified: 0 });
  const db = fakeDb(store);

  const result = await main({}, { db });

  assert.equal(result.statusCode, 200);

  for (const [id, row] of store) {
    assert.ok(
      row.privilege_domain != null,
      `row ${id} still has null privilege_domain after migration`
    );
    assert.ok(
      ['structural_admin', 'data_access', 'pending_classification'].includes(row.privilege_domain),
      `row ${id} has unexpected privilege_domain: ${row.privilege_domain}`
    );
  }
});

// ---------------------------------------------------------------------------
// Scenario B — large table processed in multiple bounded batches
// ---------------------------------------------------------------------------
test('bbx-apikey-mig-B: table larger than batchSize is processed in multiple bounded SELECT batches', async () => {
  // Force a small batch size so we get multiple pages without seeding hundreds of rows.
  const prevEnv = process.env.APIKEY_DOMAIN_MIGRATION_BATCH_SIZE;
  process.env.APIKEY_DOMAIN_MIGRATION_BATCH_SIZE = '3';
  try {
    // 7 unclassified rows with batch size 3 → ceil(7/3) = 3 SELECT calls
    const store = buildStore({ unclassified: 7 });
    const db = fakeDb(store);

    const result = await main({}, { db });

    assert.equal(result.statusCode, 200);

    // Must have issued at least 2 SELECT calls
    assert.ok(
      db.selectCalls.length >= 2,
      `expected >= 2 SELECT calls for 7 rows with batchSize=3, got ${db.selectCalls.length}`
    );

    // No single SELECT must have returned more than 3 rows
    for (const call of db.selectCalls) {
      assert.ok(
        call.returnedCount <= 3,
        `a SELECT returned ${call.returnedCount} rows — exceeds batchSize=3`
      );
    }

    // All rows must be classified
    for (const [id, row] of store) {
      assert.ok(row.privilege_domain != null, `row ${id} unclassified after migration`);
    }
  } finally {
    if (prevEnv === undefined) delete process.env.APIKEY_DOMAIN_MIGRATION_BATCH_SIZE;
    else process.env.APIKEY_DOMAIN_MIGRATION_BATCH_SIZE = prevEnv;
  }
});

// ---------------------------------------------------------------------------
// Scenario C — batch size configurable via env var
// ---------------------------------------------------------------------------
test('bbx-apikey-mig-C: APIKEY_DOMAIN_MIGRATION_BATCH_SIZE env var controls per-batch LIMIT', async () => {
  const prevEnv = process.env.APIKEY_DOMAIN_MIGRATION_BATCH_SIZE;
  process.env.APIKEY_DOMAIN_MIGRATION_BATCH_SIZE = '2';
  try {
    const store = buildStore({ unclassified: 4 });
    const db = fakeDb(store);

    await main({}, { db });

    // Every keyset SELECT must have used LIMIT=2
    const keysetSelects = db.selectCalls.filter(c => c.limit !== null);
    assert.ok(keysetSelects.length >= 1, 'expected at least one keyset SELECT');
    for (const call of keysetSelects) {
      assert.equal(
        call.limit,
        2,
        `expected LIMIT=2 from env, got LIMIT=${call.limit}`
      );
    }
  } finally {
    if (prevEnv === undefined) delete process.env.APIKEY_DOMAIN_MIGRATION_BATCH_SIZE;
    else process.env.APIKEY_DOMAIN_MIGRATION_BATCH_SIZE = prevEnv;
  }
});

// ---------------------------------------------------------------------------
// Scenario D — idempotent rerun: second run issues 0 UPDATEs and 0 events
// ---------------------------------------------------------------------------
test('bbx-apikey-mig-D: second run issues no UPDATEs and emits no events', async () => {
  const store = buildStore({ unclassified: 3 });
  const db = fakeDb(store);
  const events = [];
  const publishEvent = async (topic, payload) => events.push({ topic, payload });

  // First run
  const result1 = await main({}, { db, publishEvent });
  assert.equal(result1.statusCode, 200);

  // Reset counters for second run (but same store — all rows now classified)
  db.selectCalls.length = 0;
  let updateCallCountAfterFirstRun = db.updateCallCount; // capture; we'll compare delta

  // Patch the db to track second-run updates separately
  let secondRunUpdateCount = 0;
  const origQuery = db.query.bind(db);
  db.query = async function (sql, params) {
    const isUpdate = /^\s*UPDATE\b/i.test(sql.trim());
    const res = await origQuery(sql, params);
    if (isUpdate) secondRunUpdateCount += 1;
    return res;
  };

  const eventsBefore = events.length;
  const result2 = await main({}, { db, publishEvent });
  assert.equal(result2.statusCode, 200);

  assert.equal(
    secondRunUpdateCount,
    0,
    `expected 0 UPDATE calls on second run, got ${secondRunUpdateCount}`
  );
  assert.equal(
    events.length,
    eventsBefore,
    `expected no new events on second run, got ${events.length - eventsBefore} new event(s)`
  );
});

// ---------------------------------------------------------------------------
// Scenario F — event emission preserved for pending_classification rows
// ---------------------------------------------------------------------------
test('bbx-apikey-mig-F: buildAssignedEvent published to TOPICS.ASSIGNED for pending_classification rows', async () => {
  // A path that classifyFromPath maps to pending_classification
  const pendingPath = '/v1/unknown-surface/action';
  // Seed 1 row that will classify as pending_classification
  const store = buildStore({ unclassified: 1, classified: 0, pendingPath });

  // Verify our assumption: the seeded row has an ambiguous path
  const [pendingRow] = Array.from(store.values());
  assert.equal(
    pendingRow.last_used_path,
    pendingPath,
    'test setup: first row must use the pending path'
  );

  const db = fakeDb(store);
  const publishedEvents = [];
  const publishEvent = async (topic, payload) => publishedEvents.push({ topic, payload });

  const result = await main({}, { db, publishEvent });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.pending, 1, 'expected 1 pending row');

  // Event must have been published
  assert.equal(publishedEvents.length, 1, 'expected exactly 1 event published');

  const { topic, payload } = publishedEvents[0];

  // Topic must be TOPICS.ASSIGNED
  assert.equal(topic, TOPICS.ASSIGNED, `expected topic ${TOPICS.ASSIGNED}, got ${topic}`);

  // Payload quirks: privilegeDomain='data_access' and pending_review=true
  assert.equal(payload.pending_review, true, 'expected pending_review: true');
  assert.equal(payload.privilegeDomain, 'data_access', 'expected privilegeDomain: data_access (pending quirk)');
  assert.equal(payload.memberId, pendingRow.id, `expected memberId === row.id (${pendingRow.id})`);
  assert.equal(payload.tenantId, pendingRow.tenant_id, `expected tenantId === row.tenant_id (${pendingRow.tenant_id})`);
  assert.equal(payload.assignedBy, pendingRow.id, `expected assignedBy === row.id (${pendingRow.id})`);

  // Row itself classified as pending_classification in store
  assert.equal(
    pendingRow.privilege_domain,
    'pending_classification',
    'store row must be classified as pending_classification'
  );
});
