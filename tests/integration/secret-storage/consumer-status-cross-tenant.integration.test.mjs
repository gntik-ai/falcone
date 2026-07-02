// Real-Postgres integration verification for spec change
// `scope-secret-consumer-status-to-tenant` (GitHub issue #209, bug-006).
//
// Unlike the action-layer black-box test (which uses fake repos), this exercises
// the REAL repository SQL in `secret-rotation-repo.mjs` against a real Postgres
// (tests/env). It seeds two tenants (A/B) and drives the PUBLIC action `main`,
// proving the tenant-ownership gate holds against actual queries and that no
// cross-tenant consumer/propagation data leaks.
//
// Run against tests/env:
//   bash tests/env/up.sh
//   DATABASE_URL=postgres://falcone:falcone@localhost:55432/falcone_test \
//     node --test tests/integration/secret-storage/consumer-status-cross-tenant.integration.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
const { Client } = pg;
import { main as consumerStatus } from '../../../services/provisioning-orchestrator/src/actions/secret-rotation-consumer-status.mjs';

const TENANT_A = process.env.TESTENV_TENANT_A || '11111111-1111-1111-1111-111111111111';
const TENANT_B = process.env.TESTENV_TENANT_B || '22222222-2222-2222-2222-222222222222';
const PATH_A = `tenant/${TENANT_A}/db-password`;
const PATH_B = `tenant/${TENANT_B}/db-password`;
const PATH_NONE = `tenant/${TENANT_A}/never-provisioned`;

const ownerA = { sub: 'user:a', roles: ['tenant-owner'], tenantId: TENANT_A };
const ownerB = { sub: 'user:b', roles: ['tenant-owner'], tenantId: TENANT_B };
const platform = { sub: 'ops', roles: ['platform-operator'] };

const migration = await fs.readFile(
  new URL('../../../services/provisioning-orchestrator/src/migrations/092-secret-rotation.sql', import.meta.url),
  'utf8'
);

async function setupDb() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(migration);
  await client.query(
    'TRUNCATE secret_version_states, secret_consumer_registry, secret_propagation_events, secret_rotation_events RESTART IDENTITY'
  );

  // One active version per tenant path (the partial unique index allows exactly one).
  await client.query(
    `INSERT INTO secret_version_states (secret_path, domain, tenant_id, secret_name, vault_version, state, initiated_by)
     VALUES ($1,'tenant',$2,'db-password',1,'active','seed'),
            ($3,'tenant',$4,'db-password',7,'active','seed')`,
    [PATH_A, TENANT_A, PATH_B, TENANT_B]
  );

  // A registered consumer per path.
  await client.query(
    `INSERT INTO secret_consumer_registry (secret_path, consumer_id, consumer_namespace, reload_mechanism, registered_by)
     VALUES ($1,'consumer-a','ns-a','eso_annotation','seed'),
            ($2,'consumer-b','ns-b','sighup','seed')`,
    [PATH_A, PATH_B]
  );

  // A pending propagation per path, matching each path's active vault_version.
  await client.query(
    `INSERT INTO secret_propagation_events (secret_path, vault_version, consumer_id, state)
     VALUES ($1,1,'consumer-a','pending'),
            ($2,7,'consumer-b','pending')`,
    [PATH_A, PATH_B]
  );

  return client;
}

test('scope-secret-consumer-status-to-tenant: real-Postgres tenant isolation', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL not set — boot tests/env and re-run');
    return;
  }
  const db = await setupDb();
  try {
    // Scenario 1 — cross-tenant probe: tenant A caller cannot read tenant B's path.
    await t.test('A->B cross-tenant request is forbidden and leaks no data', async () => {
      const res = await consumerStatus({ auth: ownerA, secretPath: PATH_B, db });
      assert.equal(res?.error?.status, 403, 'cross-tenant consumer-status must be 403');
      assert.equal(res?.consumers, undefined, 'no consumer data may be returned on denial');
    });

    // Scenario 2 — same-tenant read succeeds with real data.
    await t.test('A->A same-tenant request returns the consumer registry + propagation state', async () => {
      const res = await consumerStatus({ auth: ownerA, secretPath: PATH_A, db });
      assert.equal(res?.error, undefined, 'same-tenant read must not be rejected');
      assert.equal(res.consumers.length, 1);
      assert.equal(res.consumers[0].consumer_id, 'consumer-a');
      assert.equal(res.consumers[0].reload_mechanism, 'eso_annotation');
      assert.equal(res.consumers[0].state, 'pending', 'pending propagation must surface');
    });

    // Scenario 3 — platform-scoped caller is exempt: reads any tenant's path.
    await t.test('platform-operator reads tenant B path across tenants', async () => {
      const res = await consumerStatus({ auth: platform, secretPath: PATH_B, db });
      assert.equal(res?.error, undefined, 'platform-scoped read must succeed cross-tenant');
      assert.equal(res.consumers.length, 1);
      assert.equal(res.consumers[0].consumer_id, 'consumer-b');
    });

    // Scenario 4 — no active version → 403 for a tenant-scoped caller.
    await t.test('no active version returns 403 for tenant-scoped caller', async () => {
      const res = await consumerStatus({ auth: ownerA, secretPath: PATH_NONE, db });
      assert.equal(res?.error?.status, 403, 'missing active version must be 403');
      assert.equal(res?.consumers, undefined);
    });

    // Boundary control — the path A is denied IS readable by its true owner,
    // proving the denial is the cross-tenant boundary, not a broken path/seed.
    await t.test('owner B can read PATH_B (denial is specifically cross-tenant)', async () => {
      const res = await consumerStatus({ auth: ownerB, secretPath: PATH_B, db });
      assert.equal(res?.error, undefined);
      assert.equal(res.consumers[0].consumer_id, 'consumer-b');
    });
  } finally {
    await db.end();
  }
});
