/**
 * REAL-STACK regression test for GitHub issue #220 / bug-018 —
 * batch-api-key-domain-migration.
 *
 * This codebase ships pure-logic actions with no in-repo HTTP server or UI,
 * so a user-facing Playwright E2E is not applicable here. Instead this test
 * exercises the fix directly against the REAL backing stack the system uses
 * (tests/env):
 *
 *   - Postgres (pg)   : the action's keyset-paginated SELECT and batched
 *                       VALUES-join UPDATE are executed against real Postgres,
 *                       including the ::uuid and ::text casts that are only
 *                       meaningful against a real wire protocol.  The api_keys
 *                       table is created by this test (there is no in-repo
 *                       migration for it yet) and is test-owned: seeded,
 *                       truncated, and dropped entirely by this suite.
 *   - Redpanda/Kafka  : the publishEvent wrapper produces real messages to
 *                       Redpanda; offset advancement is verified via the admin
 *                       API to prove end-to-end delivery.
 *
 * Schema note: the api_keys table is created in before() and dropped in
 * after().  No other spec or service in the test env touches this table.
 * beforeEach() issues TRUNCATE api_keys to give each scenario a clean slate.
 *
 * Run (stack must already be up):
 *   source tests/env/env.sh && \
 *     node --test tests/e2e/issues/batch-api-key-domain-migration.realstack.test.mjs
 *
 * OpenSpec change: batch-api-key-domain-migration  (GitHub issue #220, bug-018)
 * Scenarios covered:
 *   RS-A      Skip-already-classified: pre-classified rows are not touched
 *   RS-E      All-unclassified classified on first run
 *   RS-SCOPE  Global scope: both tenant A and tenant B rows are classified
 *             (intentionally global — issue #220 is NOT a tenant-isolation
 *             defect; a cross-tenant denial probe is explicitly not applicable)
 *   RS-B      Multiple bounded batches (batch size 3, 7 rows → ≥3 SELECTs)
 *   RS-C      Batch size configurable via env var (each SELECT uses the param)
 *   RS-D      Idempotent rerun: second run issues 0 UPDATEs and 0 events
 *   RS-F      Event emission preserved for pending_classification rows
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// CJS packages loaded via createRequire.
// pg is NOT in provisioning-orchestrator's node_modules — use realtime-gateway's,
// same pattern as fail-closed-realtime-auth-flag.realstack.test.mjs.
const require = createRequire(import.meta.url);
const { Pool } = require('../../../services/realtime-gateway/node_modules/pg/lib/index.js');
const { Kafka, logLevel } = require('kafkajs');

// The system under test: the migration action.
import { main } from '../../../services/provisioning-orchestrator/src/actions/api-key-domain-migration.mjs';
// TOPICS from the events module, used to assert the correct topic name.
import { TOPICS } from '../../../services/provisioning-orchestrator/src/events/privilege-domain-events.mjs';

// ---------------------------------------------------------------------------
// Gate: skip the whole suite when the test environment is not running.
// ---------------------------------------------------------------------------
const DB_URL   = process.env.DB_URL;
const BROKERS  = process.env.KAFKA_BROKERS;
const TENANT_A = process.env.TESTENV_TENANT_A;
const TENANT_B = process.env.TESTENV_TENANT_B;

const RUN =
  process.env.FALCONE_TESTENV === '1' &&
  !!DB_URL &&
  !!BROKERS &&
  !!TENANT_A &&
  !!TENANT_B;

// Unique suffix per run so nothing can clash across parallel or repeat runs.
const RUN_ID = `r${Date.now().toString(36)}`;

// ---------------------------------------------------------------------------
// Observability wrapper: wraps a real pg.Pool so queries execute against
// real Postgres while the test can inspect batching behaviour.
// ---------------------------------------------------------------------------
function wrapDb(pool) {
  const selects = [];   // { sql, limit, returnedCount }
  let updateCount = 0;
  const db = {
    selects,
    get updateCount() { return updateCount; },
    async query(sql, params) {
      const res = await pool.query(sql, params);
      const s = sql.trim();
      if (/^SELECT/i.test(s)) {
        selects.push({ sql: s, limit: params?.[1] ?? null, returnedCount: res.rows.length });
      } else if (/^UPDATE/i.test(s)) {
        updateCount += 1;
      }
      return res;
    },
  };
  return db;
}

// ---------------------------------------------------------------------------
// Kafka helpers (verbatim from template).
// ---------------------------------------------------------------------------

/** Fetch the current high-water offset for partition 0 of a topic. */
async function topicHighOffset(kafkaAdmin, topic) {
  try {
    const offsets = await kafkaAdmin.fetchTopicOffsets(topic);
    return Number(offsets[0]?.high ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Poll until the high-water offset of `topic` exceeds `startOffset`.
 * Uses simple offset polling — no consumer group / seek required.
 */
async function waitForOffsetAdvance(kafkaAdmin, topic, startOffset, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const high = await topicHighOffset(kafkaAdmin, topic);
    if (high > startOffset) return high;
    await new Promise((r) => setTimeout(r, 200));
  }
  const finalOffset = await topicHighOffset(kafkaAdmin, topic);
  if (finalOffset > startOffset) return finalOffset;
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for offset on ${topic} to advance past ${startOffset} (current: ${finalOffset})`
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe(
  `issue #220 batch-api-key-domain-migration — REAL stack (Postgres + Redpanda) [${RUN_ID}]`,
  { skip: !RUN ? 'tests/env not running (set FALCONE_TESTENV=1 via source tests/env/env.sh)' : false },
  () => {
    let pool;
    let kafka;
    let kafkaAdmin;
    let producer;

    // -----------------------------------------------------------------------
    // before: create test-owned api_keys table; connect Kafka.
    // -----------------------------------------------------------------------
    before(async () => {
      pool = new Pool({ connectionString: DB_URL });

      // Create the api_keys table.  This table is ONLY used by this test suite
      // (no in-repo migration exists for it).  The CHECK constraint mirrors the
      // production invariant validated by the action.  id defaults via
      // gen_random_uuid() so UUIDs are real and the ::uuid cast in the batched
      // UPDATE is exercised with meaningful wire-protocol values.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS api_keys (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id TEXT NOT NULL,
          workspace_id TEXT,
          last_used_endpoint_category TEXT,
          last_used_path TEXT,
          privilege_domain TEXT CHECK (privilege_domain IN ('structural_admin','data_access','pending_classification'))
        )
      `);

      // Connect Kafka / Redpanda.
      kafka = new Kafka({
        clientId: `bak-e2e-220-${RUN_ID}`,
        brokers: BROKERS.split(','),
        logLevel: logLevel.NOTHING
      });
      kafkaAdmin = kafka.admin();
      await kafkaAdmin.connect();

      // Ensure the ASSIGNED topic exists (createTopics is idempotent).
      await kafkaAdmin.createTopics({
        topics: [{ topic: TOPICS.ASSIGNED, numPartitions: 1, replicationFactor: 1 }],
        waitForLeaders: true
      });

      producer = kafka.producer();
      await producer.connect();
    });

    // -----------------------------------------------------------------------
    // after: drop test-owned table; disconnect Kafka.  Best-effort.
    // -----------------------------------------------------------------------
    after(async () => {
      try { if (pool) await pool.query('DROP TABLE IF EXISTS api_keys'); } catch { /* non-fatal */ }
      try { if (producer) await producer.disconnect(); } catch { /* noop */ }
      try { if (kafkaAdmin) await kafkaAdmin.disconnect(); } catch { /* noop */ }
      try { if (pool) await pool.end(); } catch { /* noop */ }
    });

    // -----------------------------------------------------------------------
    // beforeEach: clean slate per scenario.
    // -----------------------------------------------------------------------
    beforeEach(async () => {
      await pool.query('TRUNCATE api_keys');
    });

    // -----------------------------------------------------------------------
    // RS-A: pre-classified rows are skipped; only unclassified rows are updated.
    // -----------------------------------------------------------------------
    it('RS-A: pre-classified rows are not touched; alreadyClassified is always 0', async () => {
      // Seed 2 already-classified rows and 1 unclassified row.
      const { rows: pre } = await pool.query(`
        INSERT INTO api_keys (tenant_id, workspace_id, last_used_path, privilege_domain)
        VALUES
          ($1, 'ws1', '/v1/tenants/x',  'structural_admin'),
          ($1, 'ws2', '/v1/objects/x',  'data_access')
        RETURNING id, privilege_domain
      `, [TENANT_A]);

      const { rows: unclassified } = await pool.query(`
        INSERT INTO api_keys (tenant_id, workspace_id, last_used_path, privilege_domain)
        VALUES ($1, 'ws3', '/v1/schemas/x', NULL)
        RETURNING id
      `, [TENANT_A]);

      const wrappedDb = wrapDb(pool);
      const published = [];
      const publishEvent = async (topic, payload) => { published.push({ topic, payload }); };

      const result = await main({}, { db: wrappedDb, publishEvent });

      // (a) Every recorded SELECT must contain WHERE privilege_domain IS NULL and a LIMIT.
      assert.ok(wrappedDb.selects.length >= 1, 'at least one SELECT must have been issued');
      for (const sel of wrappedDb.selects) {
        assert.ok(
          /WHERE privilege_domain IS NULL/i.test(sel.sql),
          `SELECT must filter WHERE privilege_domain IS NULL, got: ${sel.sql}`
        );
        assert.ok(
          sel.limit !== null,
          `SELECT must carry a LIMIT param, got limit=${sel.limit}`
        );
      }

      // (b) At least one UPDATE was issued for the unclassified row; pre-classified rows
      //     remain unchanged in the DB.
      assert.ok(wrappedDb.updateCount >= 1, 'at least one UPDATE must have been issued');
      for (const row of pre) {
        const { rows } = await pool.query('SELECT privilege_domain FROM api_keys WHERE id = $1', [row.id]);
        assert.equal(
          rows[0].privilege_domain,
          row.privilege_domain,
          `pre-classified row ${row.id} must retain its original privilege_domain`
        );
      }

      // (c) No event was emitted for pre-classified row IDs.
      const preIds = new Set(pre.map(r => r.id));
      for (const ev of published) {
        assert.ok(
          !preIds.has(ev.payload.memberId),
          `No event must be emitted for pre-classified row id=${ev.payload.memberId}`
        );
      }

      // (d) alreadyClassified is always 0.
      assert.equal(result.body.alreadyClassified, 0, 'alreadyClassified must always be 0');

      // Verify the unclassified row was classified.
      const { rows: after } = await pool.query(
        'SELECT privilege_domain FROM api_keys WHERE id = $1',
        [unclassified[0].id]
      );
      assert.ok(
        after[0].privilege_domain !== null,
        'the previously unclassified row must now have a non-null privilege_domain'
      );
    });

    // -----------------------------------------------------------------------
    // RS-E: all unclassified rows are classified on a single run.
    // -----------------------------------------------------------------------
    it('RS-E: all 5 unclassified rows receive a non-null privilege_domain after one run', async () => {
      // Seed 5 rows with paths that map to known categories.
      await pool.query(`
        INSERT INTO api_keys (tenant_id, workspace_id, last_used_path, privilege_domain)
        VALUES
          ($1, 'ws1', '/v1/collections/x',        NULL),
          ($1, 'ws2', '/v1/objects/y',             NULL),
          ($1, 'ws3', '/v1/tenants/t1',            NULL),
          ($1, 'ws4', '/v1/schemas/s1',            NULL),
          ($1, 'ws5', '/v1/functions/abc/invoke',  NULL)
      `, [TENANT_A]);

      const wrappedDb = wrapDb(pool);
      const result = await main({}, { db: wrappedDb, publishEvent: async () => {} });

      assert.equal(result.statusCode, 200, 'statusCode must be 200');

      // All 5 rows must now have a privilege_domain in the allowed set.
      const { rows } = await pool.query(`
        SELECT id, privilege_domain FROM api_keys ORDER BY id
      `);
      assert.equal(rows.length, 5, 'must have exactly 5 rows');
      const allowed = new Set(['structural_admin', 'data_access', 'pending_classification']);
      for (const row of rows) {
        assert.ok(
          row.privilege_domain !== null && allowed.has(row.privilege_domain),
          `row ${row.id} must have a valid privilege_domain, got: ${row.privilege_domain}`
        );
      }
      assert.equal(
        result.body.classified + result.body.pending,
        5,
        'classified + pending must equal total rows processed'
      );
    });

    // -----------------------------------------------------------------------
    // RS-SCOPE: global scope — rows for BOTH tenants are classified.
    //
    // NOTE: this change is intentionally global (issue #220 explicitly states
    // it is NOT a tenant-isolation defect — the migration must visit all
    // tenants without a per-tenant filter).  A cross-tenant *denial* probe is
    // therefore not applicable; the relevant invariant is that global scope is
    // preserved and both tenants' rows are classified in one run.
    // -----------------------------------------------------------------------
    it('RS-SCOPE: rows for both tenant A and tenant B are classified in a single run', async () => {
      // Seed unclassified rows for both tenants.
      await pool.query(`
        INSERT INTO api_keys (tenant_id, workspace_id, last_used_path, privilege_domain)
        VALUES
          ($1, 'ws-a', '/v1/collections/items', NULL),
          ($1, 'ws-a', '/v1/api-keys/k1',       NULL),
          ($2, 'ws-b', '/v1/objects/data',       NULL),
          ($2, 'ws-b', '/v1/workspaces/w1',      NULL)
      `, [TENANT_A, TENANT_B]);

      const wrappedDb = wrapDb(pool);
      const result = await main({}, { db: wrappedDb, publishEvent: async () => {} });

      assert.equal(result.statusCode, 200);

      // All 4 rows must be classified regardless of tenant.
      const { rows } = await pool.query(`SELECT tenant_id, privilege_domain FROM api_keys ORDER BY tenant_id`);
      assert.equal(rows.length, 4);
      for (const row of rows) {
        assert.ok(
          row.privilege_domain !== null,
          `row for tenant ${row.tenant_id} must be classified; got null`
        );
      }

      // Both tenants must have at least one classified row.
      const tenantsClassified = new Set(rows.map(r => r.tenant_id));
      assert.ok(tenantsClassified.has(TENANT_A), 'tenant A rows must be classified');
      assert.ok(tenantsClassified.has(TENANT_B), 'tenant B rows must be classified');
    });

    // -----------------------------------------------------------------------
    // RS-B: multiple bounded batches when rows > batch size.
    // -----------------------------------------------------------------------
    it('RS-B: batch size 3 with 7 rows → at least 3 keyset SELECTs, each returnedCount ≤ 3', async () => {
      // Seed 7 unclassified rows.
      await pool.query(`
        INSERT INTO api_keys (tenant_id, workspace_id, last_used_path, privilege_domain)
        VALUES
          ($1, 'ws1', '/v1/collections/a', NULL),
          ($1, 'ws2', '/v1/objects/b',     NULL),
          ($1, 'ws3', '/v1/tenants/c',     NULL),
          ($1, 'ws4', '/v1/schemas/d',     NULL),
          ($1, 'ws5', '/v1/api-keys/e',    NULL),
          ($1, 'ws6', '/v1/objects/f',     NULL),
          ($1, 'ws7', '/v1/workspaces/g',  NULL)
      `, [TENANT_A]);

      const prior = process.env.APIKEY_DOMAIN_MIGRATION_BATCH_SIZE;
      process.env.APIKEY_DOMAIN_MIGRATION_BATCH_SIZE = '3';
      const wrappedDb = wrapDb(pool);
      let result;
      try {
        result = await main({}, { db: wrappedDb, publishEvent: async () => {} });
      } finally {
        if (prior === undefined) delete process.env.APIKEY_DOMAIN_MIGRATION_BATCH_SIZE;
        else process.env.APIKEY_DOMAIN_MIGRATION_BATCH_SIZE = prior;
      }

      // At least 3 SELECT pages (3+3+1).
      assert.ok(
        wrappedDb.selects.length >= 3,
        `expected at least 3 keyset SELECTs for 7 rows at batch 3, got ${wrappedDb.selects.length}`
      );
      // Each page must have returned ≤ 3 rows.
      for (const sel of wrappedDb.selects) {
        assert.ok(
          sel.returnedCount <= 3,
          `each SELECT page must return ≤ 3 rows, got ${sel.returnedCount}`
        );
      }

      // All 7 rows must be classified.
      const { rows } = await pool.query('SELECT privilege_domain FROM api_keys');
      assert.equal(rows.length, 7);
      for (const row of rows) {
        assert.ok(row.privilege_domain !== null, 'every row must be classified');
      }
    });

    // -----------------------------------------------------------------------
    // RS-C: every keyset SELECT uses the configured batch size as its LIMIT param.
    // -----------------------------------------------------------------------
    it('RS-C: batch size 2 → every keyset SELECT has limit === 2 and returnedCount ≤ 2', async () => {
      // Seed 4 unclassified rows.
      await pool.query(`
        INSERT INTO api_keys (tenant_id, workspace_id, last_used_path, privilege_domain)
        VALUES
          ($1, 'ws1', '/v1/collections/p', NULL),
          ($1, 'ws2', '/v1/objects/q',     NULL),
          ($1, 'ws3', '/v1/tenants/r',     NULL),
          ($1, 'ws4', '/v1/schemas/s',     NULL)
      `, [TENANT_A]);

      const prior = process.env.APIKEY_DOMAIN_MIGRATION_BATCH_SIZE;
      process.env.APIKEY_DOMAIN_MIGRATION_BATCH_SIZE = '2';
      const wrappedDb = wrapDb(pool);
      try {
        await main({}, { db: wrappedDb, publishEvent: async () => {} });
      } finally {
        if (prior === undefined) delete process.env.APIKEY_DOMAIN_MIGRATION_BATCH_SIZE;
        else process.env.APIKEY_DOMAIN_MIGRATION_BATCH_SIZE = prior;
      }

      assert.ok(wrappedDb.selects.length >= 2, 'at least 2 SELECT pages for 4 rows at batch 2');
      for (const sel of wrappedDb.selects) {
        assert.equal(
          sel.limit,
          2,
          `every keyset SELECT must carry limit=2 as the $2 param, got: ${sel.limit}`
        );
        assert.ok(
          sel.returnedCount <= 2,
          `each SELECT page must return ≤ 2 rows, got ${sel.returnedCount}`
        );
      }
    });

    // -----------------------------------------------------------------------
    // RS-D: idempotent rerun — second execution issues 0 UPDATEs and 0 events.
    // -----------------------------------------------------------------------
    it('RS-D: second run is a no-op: 0 UPDATEs, 0 published events, ASSIGNED topic offset unchanged', async () => {
      // Seed 3 unclassified rows.
      await pool.query(`
        INSERT INTO api_keys (tenant_id, workspace_id, last_used_path, privilege_domain)
        VALUES
          ($1, 'ws1', '/v1/collections/x', NULL),
          ($1, 'ws2', '/v1/api-keys/y',    NULL),
          ($1, 'ws3', '/v1/objects/z',     NULL)
      `, [TENANT_A]);

      // First run — classifies all rows.
      const wrappedDb1 = wrapDb(pool);
      const published1 = [];
      await main({}, {
        db: wrappedDb1,
        publishEvent: async (topic, payload) => {
          published1.push({ topic, payload });
          await producer.send({ topic, messages: [{ value: JSON.stringify(payload) }] });
        }
      });

      // Capture the ASSIGNED topic offset after the first run.
      const offsetAfterFirst = await topicHighOffset(kafkaAdmin, TOPICS.ASSIGNED);

      // Second run with fresh wrappers — everything already classified.
      const wrappedDb2 = wrapDb(pool);
      const published2 = [];
      const result2 = await main({}, {
        db: wrappedDb2,
        publishEvent: async (topic, payload) => {
          published2.push({ topic, payload });
          await producer.send({ topic, messages: [{ value: JSON.stringify(payload) }] });
        }
      });

      // 0 UPDATEs on the second run.
      assert.equal(wrappedDb2.updateCount, 0, 'second run must issue 0 UPDATEs');

      // 0 events published on the second run.
      assert.equal(published2.length, 0, 'second run must publish 0 events');

      // ASSIGNED topic offset must not advance during the second run.
      const offsetAfterSecond = await topicHighOffset(kafkaAdmin, TOPICS.ASSIGNED);
      assert.equal(
        offsetAfterSecond,
        offsetAfterFirst,
        `ASSIGNED topic offset must not advance on second run (expected ${offsetAfterFirst}, got ${offsetAfterSecond})`
      );

      assert.equal(result2.statusCode, 200);
      assert.equal(result2.body.classified, 0);
      assert.equal(result2.body.pending, 0);
      assert.equal(result2.body.alreadyClassified, 0);
    });

    // -----------------------------------------------------------------------
    // RS-F: pending_classification rows emit an ASSIGNED event with the correct
    //        payload shape, and the event is delivered to real Redpanda.
    // -----------------------------------------------------------------------
    it('RS-F: pending_classification row emits ASSIGNED event with correct payload to Redpanda', async () => {
      // Seed 1 row whose path maps to pending_classification.
      const { rows: seeded } = await pool.query(`
        INSERT INTO api_keys (tenant_id, workspace_id, last_used_path, last_used_endpoint_category, privilege_domain)
        VALUES ($1, 'ws-f', '/v1/unknown-surface/x', NULL, NULL)
        RETURNING id, tenant_id, workspace_id
      `, [TENANT_A]);
      const row = seeded[0];

      const offsetBefore = await topicHighOffset(kafkaAdmin, TOPICS.ASSIGNED);

      const published = [];
      const publishEvent = async (topic, payload) => {
        published.push({ topic, payload });
        await producer.send({ topic, messages: [{ value: JSON.stringify(payload) }] });
      };

      const wrappedDb = wrapDb(pool);
      const result = await main({}, { db: wrappedDb, publishEvent });

      // result.body.pending must be 1.
      assert.equal(result.body.pending, 1, 'pending count must be 1');
      assert.equal(result.body.classified, 0, 'classified count must be 0 (no deterministic path)');

      // The row in the DB must be 'pending_classification'.
      const { rows: dbRows } = await pool.query(
        'SELECT privilege_domain FROM api_keys WHERE id = $1',
        [row.id]
      );
      assert.equal(
        dbRows[0].privilege_domain,
        'pending_classification',
        "row must be set to 'pending_classification' in the DB"
      );

      // Exactly 1 event published, to TOPICS.ASSIGNED.
      assert.equal(published.length, 1, 'exactly 1 event must be published');
      assert.equal(published[0].topic, TOPICS.ASSIGNED, `event must go to TOPICS.ASSIGNED (${TOPICS.ASSIGNED})`);

      // Payload shape assertions.
      const payload = published[0].payload;
      assert.equal(payload.memberId, row.id, 'payload.memberId must be the row id');
      assert.equal(payload.tenantId, row.tenant_id, 'payload.tenantId must match the row tenant_id');
      assert.equal(payload.privilegeDomain, 'data_access', "payload.privilegeDomain must be 'data_access'");
      assert.equal(payload.pending_review, true, 'payload.pending_review must be true');

      // The ASSIGNED topic offset must have advanced (real delivery to Redpanda confirmed).
      const offsetAfter = await waitForOffsetAdvance(kafkaAdmin, TOPICS.ASSIGNED, offsetBefore);
      assert.ok(
        offsetAfter > offsetBefore,
        `ASSIGNED topic offset must advance after event emission (before=${offsetBefore}, after=${offsetAfter})`
      );
    });
  }
);
