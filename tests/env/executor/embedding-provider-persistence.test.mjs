// Real-Postgres proof for change add-embedding-provider-persistence.
//
// The embedding-provider store gains a Postgres-backed implementation so provider
// configuration survives a control-plane restart and is visible to all replicas that
// share the metadata DB. This test proves DURABILITY ACROSS A FRESH STORE INSTANCE on
// the SAME Postgres (restart / second-replica simulation):
//   - store S1 {pool} deployProvider → row in workspace_embedding_providers
//   - store S2 {pool} on the SAME pool reads the SAME row (no shared in-memory state)
//   - removeProvider on S1 deletes the row; S2 then reads null
//   - replacing a provider returns the re-index warning
//   - the secret_ref column holds ONLY the secretRef object (no plaintext key)
//   - rows are keyed by (tenant_id, workspace_id) — no cross-tenant leakage
//   - ensureSchema() is idempotent
//
// Needs only PLAIN Postgres (no pgvector). The run.sh DB uses the pgvector image, but
// this suite MUST NOT self-skip on a non-pgvector DB.
//
//   bash tests/env/executor/run.sh        (brings up tests/env Postgres)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createEmbeddingProviderStore } from '../../../apps/control-plane/src/runtime/embedding-executor.mjs';

const { Pool } = pg;

const ADMIN_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;

const PROBE_DB = 'emb_persist_probe';

// A clearly non-provider placeholder (GitHub push protection rejects sk_live_ etc.).
const FAKE_KEY = 'placeholder-not-a-real-key';

const TEN_A = 'ten_emb_a';
const WS_1 = 'ws_emb_1';
const TEN_B = 'ten_emb_b';

let bootstrap; // superuser → default db (create/drop probe db)
let pool; // shared pool to the probe db (both S1 and S2 use it)

const probeUrl = () => ADMIN_URL.replace(/\/[^/]+$/, `/${PROBE_DB}`);

before(async () => {
  bootstrap = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
  await bootstrap.query(`CREATE DATABASE ${PROBE_DB}`);
  pool = new Pool({ connectionString: probeUrl(), max: 4 });
});

after(async () => {
  await pool?.end().catch(() => {});
  if (bootstrap) {
    // Plain (non-FORCE) drop — the pool above is fully ended; FORCE could kill a local
    // connection that is still closing, which node:test flags as async-after-teardown.
    // Any residue is FORCE-dropped by the next run's before() hook (fresh process).
    await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB}`).catch(() => {});
    await bootstrap.end().catch(() => {});
  }
});

// emb-persist-01: deployProvider on S1 inserts a row into workspace_embedding_providers.
test('emb-persist-01: deployProvider on S1 inserts a persisted row', async () => {
  const s1 = createEmbeddingProviderStore({ pool });
  await s1.ensureSchema();
  await s1.deployProvider(WS_1, {
    tenantId: TEN_A,
    providerType: 'openai',
    model: 'text-embedding-3-small',
    endpoint: 'https://embeddings.example.test/v1/embeddings',
    dimension: 1536,
    secretRef: { name: 'BYOK_WS1_EMBEDDING_KEY' },
  });
  const res = await pool.query(
    'SELECT tenant_id, workspace_id, provider_type, model, dimension FROM workspace_embedding_providers WHERE workspace_id = $1',
    [WS_1],
  );
  assert.equal(res.rowCount, 1, 'one row persisted');
  assert.equal(res.rows[0].tenant_id, TEN_A);
  assert.equal(res.rows[0].provider_type, 'openai');
  assert.equal(res.rows[0].model, 'text-embedding-3-small');
  assert.equal(res.rows[0].dimension, 1536);
});

// emb-persist-02: a SECOND store S2 on the SAME pool reads the SAME row (cross-instance /
// restart / second-replica read — no shared in-memory state).
test('emb-persist-02: a fresh store S2 on the same pool reads the row written by S1', async () => {
  const s2 = createEmbeddingProviderStore({ pool });
  const got = await s2.getProvider(WS_1);
  assert.ok(got, 'S2 reads the provider written by S1');
  assert.equal(got.providerType, 'openai');
  assert.equal(got.model, 'text-embedding-3-small');
  assert.equal(got.endpoint, 'https://embeddings.example.test/v1/embeddings');
  assert.equal(Number(got.dimension), 1536);
  assert.deepEqual(got.secretRef, { name: 'BYOK_WS1_EMBEDDING_KEY' });
});

// emb-persist-04: replacing an existing provider (second deployProvider) returns a warning.
test('emb-persist-04: replacing an existing provider returns a re-index warning', async () => {
  const s1 = createEmbeddingProviderStore({ pool });
  const res = await s1.deployProvider(WS_1, {
    tenantId: TEN_A,
    providerType: 'cohere',
    model: 'embed-english-v3',
    secretRef: { name: 'BYOK_WS1_EMBEDDING_KEY_2' },
  });
  assert.ok(res.warning, 'replacement surfaces a warning');
  assert.match(res.warning, /re-?index|existing|previous/i);

  // First-time deploy on a brand-new workspace must NOT warn.
  const first = await s1.deployProvider('ws_emb_fresh', {
    tenantId: TEN_A, providerType: 'openai', model: 'm', secretRef: { name: 'BYOK_FRESH_KEY' },
  });
  assert.ok(!first.warning, 'first deploy has no warning');
});

// emb-persist-05: secret_ref column contains the secretRef object; NO plaintext key.
test('emb-persist-05: secret_ref persists only the secretRef — no plaintext apiKey/secret', async () => {
  const s1 = createEmbeddingProviderStore({ pool });
  await s1.deployProvider('ws_emb_secret', {
    tenantId: TEN_A,
    providerType: 'openai',
    model: 'm',
    secretRef: { name: 'BYOK_WS_SECRET_KEY' },
    apiKey: FAKE_KEY, // a caller (mis)passing plaintext — MUST be stripped
    secret: FAKE_KEY,
  });
  const res = await pool.query(
    'SELECT secret_ref FROM workspace_embedding_providers WHERE workspace_id = $1',
    ['ws_emb_secret'],
  );
  const stored = res.rows[0].secret_ref;
  assert.deepEqual(stored, { name: 'BYOK_WS_SECRET_KEY' }, 'only the secretRef is stored');
  const raw = JSON.stringify(res.rows[0]);
  assert.ok(!raw.includes(FAKE_KEY), 'no plaintext key anywhere in the persisted row');

  // A subsequent read through the store also never exposes a plaintext key field.
  const got = await s1.getProvider('ws_emb_secret');
  assert.ok(!('apiKey' in got) && !('secret' in got), 'read exposes only a secretRef');
  assert.deepEqual(got.secretRef, { name: 'BYOK_WS_SECRET_KEY' });
});

// emb-persist-06: two workspaces under different tenant_id values are stored independently
// (same workspaceId value can coexist under a different tenant — no cross-tenant leakage).
test('emb-persist-06: rows are keyed by (tenant_id, workspace_id) — no cross-tenant leakage', async () => {
  const store = createEmbeddingProviderStore({ pool });
  const SHARED_WS = 'ws_emb_shared';
  await store.deployProvider(SHARED_WS, { tenantId: TEN_A, providerType: 'openai', model: 'model-a', secretRef: { name: 'BYOK_A_KEY' } });
  await store.deployProvider(SHARED_WS, { tenantId: TEN_B, providerType: 'cohere', model: 'model-b', secretRef: { name: 'BYOK_B_KEY' } });

  const rows = await pool.query(
    'SELECT tenant_id, model FROM workspace_embedding_providers WHERE workspace_id = $1 ORDER BY tenant_id',
    [SHARED_WS],
  );
  assert.equal(rows.rowCount, 2, 'both tenants have an independent row for the same workspaceId');
  const byTenant = Object.fromEntries(rows.rows.map((r) => [r.tenant_id, r.model]));
  assert.equal(byTenant[TEN_A], 'model-a');
  assert.equal(byTenant[TEN_B], 'model-b');
});

// emb-persist-03: removeProvider on S1 deletes the row; S2 subsequently returns null.
test('emb-persist-03: removeProvider on S1 deletes the row and S2 reads null', async () => {
  const s1 = createEmbeddingProviderStore({ pool });
  const s2 = createEmbeddingProviderStore({ pool });
  const removed = await s1.removeProvider(WS_1);
  assert.deepEqual(removed, { removed: true });
  assert.equal(await s2.getProvider(WS_1), null, 'S2 reads null after S1 delete');

  // Removing an absent provider returns removed:false.
  const again = await s1.removeProvider(WS_1);
  assert.deepEqual(again, { removed: false });
});

// emb-persist-07: ensureSchema() is idempotent — calling it twice does not error.
test('emb-persist-07: ensureSchema() is idempotent', async () => {
  const store = createEmbeddingProviderStore({ pool });
  await store.ensureSchema();
  await store.ensureSchema();
  // Table is still usable after a double ensureSchema.
  const got = await store.getProvider('ws_emb_fresh');
  assert.ok(got, 'store still functional after a second ensureSchema');
});
