// Real-Postgres proof for change add-write-time-auto-embedding.
//
// Write-time auto-embedding mirrors the KNN queryText read path onto the WRITE path:
// when a per-collection mapping (sourceColumn -> targetColumn) is configured, an insert /
// bulk_insert / update that touches the source text column has its embedding generated
// in-platform and stored in the target vector(N) column — so the row is pre-indexed and
// immediately searchable via KNN.
//
// This is the integration-risk gate (design D3): the auto-embedded vector is supplied as a
// `[a,b,c]` literal STRING (the same shape the KNN read path binds with ::vector). The
// generic insert/update binder does NOT add a ::vector cast, so this suite PROVES the string
// literal coerces correctly on INSERT/UPDATE against real pgvector via the round-trip.
//
// Requires a pgvector-capable Postgres image (CREATE EXTENSION vector). If the extension is
// unavailable, the suite self-skips (the dedicated-DB image requirement).
//
//   bash tests/env/executor/run.sh        (brings up tests/env Postgres, pgvector image)
//
// Tests: auto-emb-01 .. auto-emb-08
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createConnectionRegistry } from '../../../apps/control-plane/src/runtime/connection-registry.mjs';
import { executePostgresData } from '../../../apps/control-plane/src/runtime/postgres-data-executor.mjs';
import {
  createEmbeddingExecutor,
  createEmbeddingMappingStore,
  createEmbeddingProviderStore,
  localMockEmbeddingBackend,
} from '../../../apps/control-plane/src/runtime/embedding-executor.mjs';

const { Pool } = pg;

const ADMIN_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;

const PROBE_DB = 'auto_emb_probe';
const APP_LOGIN = 'auto_emb_app';
const APP_PW = 'auto_emb_local_only';

const TEN_A = 'ten_auto_a';
const WS_A = 'ws_auto_a';
const TEN_B = 'ten_auto_b';
const WS_B = 'ws_auto_b';
const DB = 'appdb';
const DIM = 8;

let bootstrap; // superuser → default db (create/drop probe db)
let admin; // superuser → probe db (seed)
let registry; // executor connection registry (connects as the non-superuser app role)
let mappingPool; // shared metadata pool for the mapping + provider stores
let mappingStore;
let pgvectorAvailable = false;

function probeUrl(role, pw) {
  const base = ADMIN_URL.replace(/\/[^/]+$/, `/${PROBE_DB}`);
  return role ? base.replace(/\/\/[^:]+:[^@]+@/, `//${role}:${pw}@`) : base;
}

function vec(arr) {
  return `[${arr.join(',')}]`;
}

// A deterministic mock embedding executor (dimension 8). Provider configured per workspace.
function makeEmbeddingExecutor() {
  return createEmbeddingExecutor({
    store: createEmbeddingProviderStore({ pool: mappingPool }),
    backendFactory: () => localMockEmbeddingBackend({ dimension: DIM }),
  });
}

before(async () => {
  bootstrap = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
  await bootstrap.query(`CREATE DATABASE ${PROBE_DB}`);

  admin = new Pool({ connectionString: probeUrl(), max: 2 });
  await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  try {
    await admin.query('CREATE EXTENSION IF NOT EXISTS vector');
    pgvectorAvailable = true;
  } catch {
    pgvectorAvailable = false;
    return; // skip seeding; tests will skip
  }

  await admin.query(`CREATE TABLE public.docs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id text NOT NULL,
      workspace_id text NOT NULL,
      body text NOT NULL,
      embedding vector(${DIM})
    )`);

  // Non-superuser, NON-BYPASSRLS app role (member of falcone_app group) — RLS only enforces
  // against such a role.
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'falcone_app') THEN
      CREATE ROLE falcone_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
    END IF;
  END $$;`);
  await admin.query(`DROP ROLE IF EXISTS ${APP_LOGIN}`);
  await admin.query(`CREATE ROLE ${APP_LOGIN} LOGIN PASSWORD '${APP_PW}' NOSUPERUSER NOBYPASSRLS IN ROLE falcone_app`);
  await admin.query(`GRANT USAGE ON SCHEMA public TO falcone_app`);
  await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.docs TO falcone_app`);

  // RLS policy bound to the session GUC the executor sets (app.current_tenant_id).
  await admin.query('ALTER TABLE public.docs ENABLE ROW LEVEL SECURITY');
  await admin.query('ALTER TABLE public.docs FORCE ROW LEVEL SECURITY');
  await admin.query(`CREATE POLICY docs_tenant_isolation ON public.docs
    USING (tenant_id = current_setting('app.current_tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true))`);

  // HNSW cosine index so KNN can use the ANN scan over the auto-populated column.
  await admin.query(`CREATE INDEX docs_embedding_idx ON public.docs USING hnsw (embedding vector_cosine_ops)`);

  const appDsn = probeUrl(APP_LOGIN, APP_PW);
  registry = createConnectionRegistry({ resolveConnection: () => ({ dsn: appDsn }) });

  // Metadata pool for the durable mapping + provider stores (their own DB tables).
  mappingPool = new Pool({ connectionString: probeUrl(), max: 4 });
  mappingStore = createEmbeddingMappingStore({ pool: mappingPool });
  await mappingStore.ensureSchema();
  // The provider store (Postgres-backed, same pool) needs its own table created once.
  await createEmbeddingProviderStore({ pool: mappingPool }).ensureSchema();
});

after(async () => {
  await registry?.end().catch(() => {});
  await mappingPool?.end().catch(() => {});
  await admin?.end().catch(() => {});
  if (bootstrap) {
    await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB}`).catch(() => {});
    await bootstrap.query(`DROP ROLE IF EXISTS ${APP_LOGIN}`).catch(() => {});
    await bootstrap.end().catch(() => {});
  }
});

const reqBase = (tenantId, workspaceId, extra = {}) => ({
  workspaceId,
  databaseName: DB,
  schemaName: 'public',
  tableName: 'docs',
  identity: { tenantId, workspaceId, roleName: APP_LOGIN },
  ...extra,
});

// Read the embedding column for a row directly (as superuser, bypassing RLS) so the test can
// assert the stored value independent of the executor.
async function readEmbedding(id) {
  const r = await admin.query('SELECT embedding FROM public.docs WHERE id = $1', [id]);
  return r.rows[0]?.embedding ?? null;
}

// Configure a provider for a workspace (mock backend, dimension 8) on the shared store.
async function configureProvider(emb, tenantId, workspaceId) {
  await emb.store.deployProvider(workspaceId, {
    tenantId, providerType: 'mock', model: `mock-${DIM}`, secretRef: { name: 'BYOK_K' },
  });
}

// auto-emb-01: INSERT with source text → the target vector column is populated (non-null).
test('auto-emb-01: insert with source text auto-populates the vector column', async (t) => {
  if (!pgvectorAvailable) return t.skip('pgvector extension unavailable');
  const emb = makeEmbeddingExecutor();
  await configureProvider(emb, TEN_A, WS_A);
  await mappingStore.deployMapping(WS_A, {
    tenantId: TEN_A, schemaName: 'public', tableName: 'docs', sourceColumn: 'body', targetColumn: 'embedding',
  });

  const res = await executePostgresData(registry, {
    ...reqBase(TEN_A, WS_A, { operation: 'insert', embeddingExecutor: emb, mappingStore }),
    values: { body: 'semantic test one' },
  });
  assert.ok(res.item?.id, 'insert returns the new row id');
  const stored = await readEmbedding(res.item.id);
  assert.ok(stored, 'embedding column is populated (non-null)');
  const parsed = JSON.parse(stored);
  assert.equal(parsed.length, DIM, 'stored embedding has the declared dimension');
});

// auto-emb-02: KNN search after an auto-embed insert returns the inserted row (round-trip).
test('auto-emb-02: KNN search returns an auto-embedded row (round-trip)', async (t) => {
  if (!pgvectorAvailable) return t.skip('pgvector extension unavailable');
  const emb = makeEmbeddingExecutor();
  await configureProvider(emb, TEN_A, WS_A);
  await mappingStore.deployMapping(WS_A, {
    tenantId: TEN_A, schemaName: 'public', tableName: 'docs', sourceColumn: 'body', targetColumn: 'embedding',
  });

  const ins = await executePostgresData(registry, {
    ...reqBase(TEN_A, WS_A, { operation: 'insert', embeddingExecutor: emb, mappingStore }),
    values: { body: 'round trip needle' },
  });
  assert.ok(ins.item?.id);

  // Search by the SAME text → the mock backend is deterministic, so this is the nearest row.
  const search = await executePostgresData(registry, {
    ...reqBase(TEN_A, WS_A, { operation: 'knn_search', embeddingExecutor: emb }),
    queryText: 'round trip needle', topK: 5, metric: 'cosine',
  });
  assert.ok(search.items.some((r) => r.id === ins.item.id), 'inserted row is returned by KNN');
  assert.ok(search.items.every((r) => typeof r.distance === 'number'), 'each row carries a numeric distance');
});

// auto-emb-03: INSERT with an explicit embedding → stored as-is (no override).
test('auto-emb-03: explicit target vector is stored as-is (no override)', async (t) => {
  if (!pgvectorAvailable) return t.skip('pgvector extension unavailable');
  const emb = makeEmbeddingExecutor();
  await configureProvider(emb, TEN_A, WS_A);
  await mappingStore.deployMapping(WS_A, {
    tenantId: TEN_A, schemaName: 'public', tableName: 'docs', sourceColumn: 'body', targetColumn: 'embedding',
  });
  const explicit = [0.5, -0.5, 0.25, -0.25, 0.125, -0.125, 1, -1];
  const res = await executePostgresData(registry, {
    ...reqBase(TEN_A, WS_A, { operation: 'insert', embeddingExecutor: emb, mappingStore }),
    values: { body: 'explicit vector row', embedding: vec(explicit) },
  });
  const stored = JSON.parse(await readEmbedding(res.item.id));
  assert.deepEqual(stored, explicit, 'explicit vector stored verbatim, not auto-generated');
});

// auto-emb-04: BULK INSERT → all rows get distinct non-null embeddings.
test('auto-emb-04: bulk insert auto-embeds each row independently', async (t) => {
  if (!pgvectorAvailable) return t.skip('pgvector extension unavailable');
  const emb = makeEmbeddingExecutor();
  await configureProvider(emb, TEN_A, WS_A);
  await mappingStore.deployMapping(WS_A, {
    tenantId: TEN_A, schemaName: 'public', tableName: 'docs', sourceColumn: 'body', targetColumn: 'embedding',
  });
  const res = await executePostgresData(registry, {
    ...reqBase(TEN_A, WS_A, { operation: 'bulk_insert', embeddingExecutor: emb, mappingStore }),
    rows: [{ body: 'bulk a' }, { body: 'bulk b' }, { body: 'bulk c' }],
  });
  assert.equal(res.affected, 3, 'all three rows written');
  const ids = res.items.map((r) => r.id);
  const stored = await Promise.all(ids.map(readEmbedding));
  assert.ok(stored.every((v) => v != null), 'every row has a non-null embedding');
  const asStrings = stored.map((v) => v);
  assert.equal(new Set(asStrings).size, 3, 'each row has a distinct embedding (distinct source text)');
});

// auto-emb-05: UPDATE that changes the source re-embeds; UPDATE that omits it does not.
test('auto-emb-05: update re-embeds only when the source column is in the change set', async (t) => {
  if (!pgvectorAvailable) return t.skip('pgvector extension unavailable');
  const emb = makeEmbeddingExecutor();
  await configureProvider(emb, TEN_A, WS_A);
  await mappingStore.deployMapping(WS_A, {
    tenantId: TEN_A, schemaName: 'public', tableName: 'docs', sourceColumn: 'body', targetColumn: 'embedding',
  });
  const ins = await executePostgresData(registry, {
    ...reqBase(TEN_A, WS_A, { operation: 'insert', embeddingExecutor: emb, mappingStore }),
    values: { body: 'original text' },
  });
  const v0 = await readEmbedding(ins.item.id);

  // Update the source column → embedding must change.
  await executePostgresData(registry, {
    ...reqBase(TEN_A, WS_A, { operation: 'update', embeddingExecutor: emb, mappingStore }),
    primaryKey: { id: ins.item.id }, changes: { body: 'rewritten text' },
  });
  const v1 = await readEmbedding(ins.item.id);
  assert.notEqual(v1, v0, 'embedding changes when the source text changes');

  // Update a non-source field (no body) → embedding must NOT change.
  await executePostgresData(registry, {
    ...reqBase(TEN_A, WS_A, { operation: 'update', embeddingExecutor: emb, mappingStore }),
    primaryKey: { id: ins.item.id }, changes: { workspace_id: WS_A },
  });
  const v2 = await readEmbedding(ins.item.id);
  assert.equal(v2, v1, 'embedding unchanged when the source text is not in the change set');
});

// auto-emb-06: provider missing → INSERT with source text → 422, no row written.
test('auto-emb-06: provider missing → 422 EMBEDDING_PROVIDER_MISSING, no row written', async (t) => {
  if (!pgvectorAvailable) return t.skip('pgvector extension unavailable');
  const emb = makeEmbeddingExecutor(); // NO provider configured for WS_B
  await mappingStore.deployMapping(WS_B, {
    tenantId: TEN_B, schemaName: 'public', tableName: 'docs', sourceColumn: 'body', targetColumn: 'embedding',
  });
  const before = await admin.query('SELECT count(*)::int AS n FROM public.docs WHERE tenant_id = $1', [TEN_B]);
  await assert.rejects(
    () => executePostgresData(registry, {
      ...reqBase(TEN_B, WS_B, { operation: 'insert', embeddingExecutor: emb, mappingStore }),
      values: { body: 'no provider here' },
    }),
    (e) => e.statusCode === 422 && e.code === 'EMBEDDING_PROVIDER_MISSING',
  );
  const after = await admin.query('SELECT count(*)::int AS n FROM public.docs WHERE tenant_id = $1', [TEN_B]);
  assert.equal(after.rows[0].n, before.rows[0].n, 'no row written when the provider is missing');
});

// auto-emb-07: dimension mismatch → 422, no row written.
test('auto-emb-07: dimension mismatch → 422 EMBEDDING_DIMENSION_MISMATCH, no row written', async (t) => {
  if (!pgvectorAvailable) return t.skip('pgvector extension unavailable');
  // Provider returns dimension 4 but the column is vector(8) → mismatch.
  const emb = createEmbeddingExecutor({
    store: createEmbeddingProviderStore({ pool: mappingPool }),
    backendFactory: () => localMockEmbeddingBackend({ dimension: 4 }),
  });
  await emb.store.deployProvider(WS_A, { tenantId: TEN_A, providerType: 'mock', model: 'mock-4', secretRef: { name: 'BYOK_K' } });
  await mappingStore.deployMapping(WS_A, {
    tenantId: TEN_A, schemaName: 'public', tableName: 'docs', sourceColumn: 'body', targetColumn: 'embedding',
  });
  const before = await admin.query("SELECT count(*)::int AS n FROM public.docs WHERE body = 'dim mismatch'");
  await assert.rejects(
    () => executePostgresData(registry, {
      ...reqBase(TEN_A, WS_A, { operation: 'insert', embeddingExecutor: emb, mappingStore }),
      values: { body: 'dim mismatch' },
    }),
    (e) => e.statusCode === 422 && e.code === 'EMBEDDING_DIMENSION_MISMATCH',
  );
  const after = await admin.query("SELECT count(*)::int AS n FROM public.docs WHERE body = 'dim mismatch'");
  assert.equal(after.rows[0].n, before.rows[0].n, 'no row written on dimension mismatch');

  // Re-configure the dimension-8 provider so later tests sharing WS_A still pass.
  await emb.store.deployProvider(WS_A, { tenantId: TEN_A, providerType: 'mock', model: `mock-${DIM}`, secretRef: { name: 'BYOK_K' } });
});

// auto-emb-08: cross-tenant — tenant B insert does NOT apply tenant A's mapping.
test('auto-emb-08: cross-tenant insert never applies another tenant mapping', async (t) => {
  if (!pgvectorAvailable) return t.skip('pgvector extension unavailable');
  const emb = makeEmbeddingExecutor();
  // Provider configured for BOTH so a missing-provider error cannot mask the result.
  await configureProvider(emb, TEN_A, WS_A);
  await configureProvider(emb, TEN_B, WS_A);
  // Mapping ONLY for tenant A on workspace WS_A.
  await mappingStore.deployMapping(WS_A, {
    tenantId: TEN_A, schemaName: 'public', tableName: 'docs', sourceColumn: 'body', targetColumn: 'embedding',
  });
  // Ensure tenant B has NO mapping for WS_A.
  await mappingStore.removeMapping(WS_A, {
    tenantId: TEN_B, schemaName: 'public', tableName: 'docs', targetColumn: 'embedding',
  });

  // Tenant B inserts into the SAME workspaceId/table → no mapping for B → no auto-embed.
  const res = await executePostgresData(registry, {
    ...reqBase(TEN_B, WS_A, { operation: 'insert', embeddingExecutor: emb, mappingStore }),
    values: { body: 'tenant b row' },
  });
  assert.ok(res.item?.id, 'tenant B insert succeeds');
  const stored = await readEmbedding(res.item.id);
  assert.equal(stored, null, 'tenant B row has a NULL embedding (tenant A mapping never applied)');
});
