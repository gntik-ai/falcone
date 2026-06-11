// Real-Postgres proof for change add-vector-search — the CROSS-TENANT KNN guarantee.
//
// RLS + pgvector are real-DB behaviours, so this lives in tests/env (real docker-compose
// Postgres) alongside the rest of the real-stack slice. It proves the cardinal property:
// a tenant's KNN query NEVER returns another tenant's vectors even when the other tenant's
// vector is numerically nearest to the query — because the query runs under the
// non-BYPASSRLS `falcone_app` role and the RLS policy (bound to app.current_tenant_id)
// filters candidates BEFORE pgvector ranks by distance.
//
// Requires a pgvector-capable Postgres image (CREATE EXTENSION vector). If the extension
// is unavailable, the suite is skipped (documented as the dedicated-DB image requirement).
//
//   bash tests/env/executor/run.sh        (brings up tests/env Postgres)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createConnectionRegistry } from '../../../apps/control-plane/src/runtime/connection-registry.mjs';
import { executePostgresData } from '../../../apps/control-plane/src/runtime/postgres-data-executor.mjs';
import { executePostgresDdl } from '../../../apps/control-plane/src/runtime/postgres-ddl-executor.mjs';
import { createEmbeddingExecutor, localMockEmbeddingBackend } from '../../../apps/control-plane/src/runtime/embedding-executor.mjs';

const { Pool } = pg;

const ADMIN_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;

const PROBE_DB = 'vec_knn_probe';
const APP_LOGIN = 'vec_knn_app';
const APP_PW = 'vec_knn_local_only';

const TEN_A = 'ten_a';
const WS_A = 'ws_a';
const TEN_B = 'ten_b';
const WS_B = 'ws_b';
const DB = 'appdb';

let bootstrap; // superuser → default db (create/drop probe db)
let admin; // superuser → probe db (seed)
let registry; // executor connection registry (connects as the non-superuser app role)
let ddlRegistry; // executor connection registry on the admin (owner) DSN for DDL
let app; // raw non-superuser pool for direct RLS probes
let pgvectorAvailable = false;

function probeUrl(role, pw) {
  const base = ADMIN_URL.replace(/\/[^/]+$/, `/${PROBE_DB}`);
  return role ? base.replace(/\/\/[^:]+:[^@]+@/, `//${role}:${pw}@`) : base;
}

function vec(arr) {
  return `[${arr.join(',')}]`;
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
      embedding vector(3) NOT NULL
    )`);

  // Non-superuser, NON-BYPASSRLS app role (member of falcone_app group) — RLS only
  // enforces against such a role.
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

  // HNSW cosine index so the planner can use the ANN scan (RLS still filters candidates).
  await admin.query(`CREATE INDEX docs_embedding_idx ON public.docs USING hnsw (embedding vector_cosine_ops)`);

  // Seed (as superuser): tenant A rows are FAR from the query; tenant B row is NEAREST.
  // The query vector below is [1,0,0]; tenant B's [1,0,0] is the global nearest neighbour.
  await admin.query(`INSERT INTO public.docs (tenant_id, workspace_id, body, embedding) VALUES ($1,$2,'a-far-1',$3)`, [TEN_A, WS_A, vec([0, 1, 0])]);
  await admin.query(`INSERT INTO public.docs (tenant_id, workspace_id, body, embedding) VALUES ($1,$2,'a-far-2',$3)`, [TEN_A, WS_A, vec([0, 0, 1])]);
  await admin.query(`INSERT INTO public.docs (tenant_id, workspace_id, body, embedding) VALUES ($1,$2,'b-nearest',$3)`, [TEN_B, WS_B, vec([1, 0, 0])]);

  const appDsn = probeUrl(APP_LOGIN, APP_PW);
  registry = createConnectionRegistry({ resolveConnection: () => ({ dsn: appDsn }) });
  // DDL runs on the admin (owner) connection — the app role cannot create objects.
  ddlRegistry = createConnectionRegistry({ resolveConnection: () => ({ dsn: appDsn, adminDsn: probeUrl() }) });
  app = new Pool({ connectionString: appDsn, max: 2 });
});

after(async () => {
  await app?.end().catch(() => {});
  await registry?.end().catch(() => {});
  await ddlRegistry?.end().catch(() => {});
  await admin?.end().catch(() => {});
  if (bootstrap) {
    // Plain (non-FORCE) drop — pools are already ended; FORCE could kill a still-closing
    // local connection, which node:test flags as async-after-teardown. Residue is cleaned by
    // the next run's before() FORCE-drop (fresh process, no live local connection).
    await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB}`).catch(() => {});
    await bootstrap.query(`DROP ROLE IF EXISTS ${APP_LOGIN}`).catch(() => {});
    await bootstrap.end().catch(() => {});
  }
});

const knnBase = (tenantId, workspaceId) => ({
  workspaceId,
  databaseName: DB,
  schemaName: 'public',
  tableName: 'docs',
  identity: { tenantId, workspaceId, roleName: APP_LOGIN },
  operation: 'knn_search',
});

// --- Cross-tenant KNN probe via the executor (adapter plan + RLS) --------------
test('cross-tenant KNN: tenant A query nearest to a tenant-B vector returns ZERO tenant-B rows', async (t) => {
  if (!pgvectorAvailable) return t.skip('pgvector extension unavailable');
  const res = await executePostgresData(registry, {
    ...knnBase(TEN_A, WS_A),
    queryVector: [1, 0, 0], // geometrically nearest to tenant B's [1,0,0]
    topK: 5,
    metric: 'cosine',
  });
  assert.ok(res.items.length > 0, 'tenant A sees its own rows');
  assert.ok(res.items.every((r) => r.tenant_id === TEN_A), `no tenant-B rows leaked: ${JSON.stringify(res.items.map((r) => r.tenant_id))}`);
  assert.ok(res.items.every((r) => r.body !== 'b-nearest'), 'the nearest (tenant-B) row is excluded');
  assert.ok(res.items.every((r) => typeof r.distance === 'number'), 'each row carries a numeric distance');
});

// --- Direct RLS-before-ranking probe under the non-BYPASSRLS role --------------
test('KNN ORDER BY distance under falcone_app excludes other-tenant rows from the ANN scan', async (t) => {
  if (!pgvectorAvailable) return t.skip('pgvector extension unavailable');
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [TEN_A]);
    // No explicit WHERE tenant_id — RLS must filter BEFORE the distance ranking.
    const res = await c.query(
      `SELECT tenant_id, body, embedding <=> $1::vector AS distance
         FROM public.docs ORDER BY distance LIMIT 5`,
      [vec([1, 0, 0])],
    );
    await c.query('COMMIT');
    assert.ok(res.rows.length > 0, 'tenant A sees rows');
    assert.ok(res.rows.every((r) => r.tenant_id === TEN_A), 'tenant B never enters the ranked candidate set');
  } finally {
    c.release();
  }
});

// --- Fail-closed: unset tenant context yields zero rows -----------------------
test('absent app.current_tenant_id yields zero rows (fail-closed), no cross-tenant leak', async (t) => {
  if (!pgvectorAvailable) return t.skip('pgvector extension unavailable');
  const c = await app.connect();
  try {
    // No set_config at all → current_setting(...) is NULL → policy denies all rows.
    const res = await c.query(
      `SELECT tenant_id FROM public.docs ORDER BY embedding <=> $1::vector LIMIT 5`,
      [vec([1, 0, 0])],
    );
    assert.equal(res.rows.length, 0, 'unscoped session sees nothing under FORCE RLS');
  } finally {
    c.release();
  }
});

// --- In-platform embedding (queryText → vector) end-to-end, still tenant-scoped -
test('KNN with queryText resolves an embedding and stays tenant-scoped', async (t) => {
  if (!pgvectorAvailable) return t.skip('pgvector extension unavailable');
  const embedding = createEmbeddingExecutor({
    backendFactory: () => localMockEmbeddingBackend({ dimension: 3 }),
  });
  await embedding.store.deployProvider(WS_A, { providerType: 'mock', model: 'mock-3', secretRef: { vaultPath: 'secret/ws-a/mock' } });

  const res = await executePostgresData(registry, {
    ...knnBase(TEN_A, WS_A),
    queryText: 'semantic query',
    topK: 5,
    metric: 'cosine',
    embeddingExecutor: embedding,
  });
  assert.ok(res.items.every((r) => r.tenant_id === TEN_A), 'queryText path is tenant-scoped too');
});

// --- queryText with no provider configured → 422 ------------------------------
test('KNN with queryText and no provider configured returns 422', async (t) => {
  if (!pgvectorAvailable) return t.skip('pgvector extension unavailable');
  const embedding = createEmbeddingExecutor({ backendFactory: () => localMockEmbeddingBackend({ dimension: 3 }) });
  // No provider deployed for WS_B.
  await assert.rejects(
    () => executePostgresData(registry, { ...knnBase(TEN_B, WS_B), queryText: 'x', topK: 3, embeddingExecutor: embedding }),
    (e) => e.statusCode === 422,
  );
});

// --- DDL executor end-to-end: vector column + HNSW index against real pgvector ---
test('DDL executor creates a vector(N) column and an HNSW cosine index that appear in the catalog', async (t) => {
  if (!pgvectorAvailable) return t.skip('pgvector extension unavailable');
  const ddlIdentity = { tenantId: 't_ddl', workspaceId: 'ws_ddl' };
  // Owner connection creates a fresh table to add a vector column + index to.
  await admin.query('CREATE TABLE public.ddl_docs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL)');

  const col = await executePostgresDdl(ddlRegistry, {
    resourceKind: 'column', action: 'create', workspaceId: 'ws_ddl', identity: ddlIdentity,
    payload: { databaseName: DB, schemaName: 'public', tableName: 'ddl_docs', columnName: 'embedding', dataType: 'vector', dimension: 768 },
  });
  assert.ok(col.statements.some((s) => /vector\(768\)/.test(s)), `column DDL: ${JSON.stringify(col.statements)}`);

  const introspected = await admin.query(
    'SELECT udt_name FROM information_schema.columns WHERE table_name=$1 AND column_name=$2',
    ['ddl_docs', 'embedding'],
  );
  assert.equal(introspected.rows[0]?.udt_name, 'vector', 'vector column present in information_schema');

  const idx = await executePostgresDdl(ddlRegistry, {
    resourceKind: 'index', action: 'create', workspaceId: 'ws_ddl', identity: ddlIdentity,
    payload: { databaseName: DB, schemaName: 'public', tableName: 'ddl_docs', indexName: 'ddl_docs_embedding_idx', indexMethod: 'hnsw', metric: 'cosine', keys: [{ columnName: 'embedding' }] },
  });
  assert.ok(idx.statements.some((s) => /USING HNSW \("embedding" vector_cosine_ops\)/i.test(s)), `index DDL: ${JSON.stringify(idx.statements)}`);

  const pgIndexes = await admin.query("SELECT indexdef FROM pg_indexes WHERE tablename=$1 AND indexname=$2", ['ddl_docs', 'ddl_docs_embedding_idx']);
  assert.ok(pgIndexes.rows.length === 1, 'HNSW index present in pg_indexes');
  assert.match(pgIndexes.rows[0].indexdef, /hnsw/i);
});

// --- Dimension-mismatch insert maps to a 400 ----------------------------------
test('inserting a vector of the wrong length maps to a 400 (dimension mismatch)', async (t) => {
  if (!pgvectorAvailable) return t.skip('pgvector extension unavailable');
  await assert.rejects(
    () => executePostgresData(registry, {
      ...knnBase(TEN_A, WS_A), operation: 'insert',
      values: { body: 'wrong-dim', embedding: vec([1, 2, 3, 4]) }, // column is vector(3)
    }),
    (e) => e.statusCode === 400,
  );
});
