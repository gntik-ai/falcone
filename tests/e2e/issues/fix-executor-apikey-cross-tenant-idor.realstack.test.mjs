/**
 * REAL-STACK regression test for GitHub issue #517 (Epic A #512) —
 * fix-executor-apikey-cross-tenant-idor.
 *
 * Confirmed P0 cross-tenant IDOR (live campaign 2026-06-17): the executor's
 * `POST /v1/workspaces/{workspaceId}/api-keys` route issued a key without
 * verifying that {workspaceId} belongs to the authenticated caller's tenant. A
 * tenant-A admin (tenant-only identity, NO workspace binding — so the existing
 * credential ⇄ path-workspace check does not apply) could mint a key scoped to a
 * tenant-B workspace and reach tenant-B's data plane.
 *
 * This codebase ships the executor as pure libraries with no in-repo UI, so the
 * faithful E2E is to boot the ACTUAL control-plane HTTP server against the REAL
 * tests/env Postgres and drive it over real HTTP — exactly the live attack:
 *
 *   - Postgres (pg) : the REAL `workspace_databases` ownership registry is seeded
 *                     with (WS_A → TEN_A) and (WS_B → TEN_B); the REAL
 *                     createWorkspaceTenantResolver runs its SQL against it, and
 *                     the REAL createApiKeyStore persists/reads workspace_api_keys.
 *                     Both are cleaned up per run.
 *   - Identity      : gateway-injected `x-tenant-id` (no x-workspace-id) — a
 *                     tenant-only admin, the credential class that bypassed the
 *                     binding check. No Keycloak token mint needed.
 *
 * The connection registry is a stub that throws if a data-plane connection is
 * opened, proving the 403 fires before any executor/database work.
 *
 * Run (stack must already be up):
 *   source tests/env/env.sh && \
 *     node --test tests/e2e/issues/fix-executor-apikey-cross-tenant-idor.realstack.test.mjs
 *
 * Spec change: fix-executor-apikey-cross-tenant-idor (GitHub issue #517)
 * Scenarios covered:
 *   S-IDOR  tenant-A admin → POST api-keys on a tenant-B workspace → 403 CROSS_TENANT_VIOLATION,
 *           and NO row is persisted in workspace_api_keys for the foreign workspace.
 *   S-OWN   tenant-A admin → POST api-keys on its OWN workspace → 201 with a flc_ key (unchanged).
 *   S-LIST  tenant-A admin → GET (list) api-keys on a tenant-B workspace → 403 CROSS_TENANT_VIOLATION.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createConnectionRegistry } from '../../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import { createControlPlaneServer } from '../../../apps/control-plane-executor/src/runtime/server.mjs';
import { createApiKeyStore } from '../../../apps/control-plane-executor/src/runtime/api-keys.mjs';
import { createWorkspaceTenantResolver } from '../../../apps/control-plane-executor/src/runtime/workspace-dsn-resolver.mjs';

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Gate: skip the whole suite if tests/env is not running.
// ---------------------------------------------------------------------------
const DB_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;
const RUN = process.env.FALCONE_TESTENV === '1';

// Unique suffix per run so seeded ownership/key rows never clash across reruns.
const RUN_ID = `r${Date.now().toString(36)}`;
const TEN_A = `ten_xt_a_${RUN_ID}`;
const TEN_B = `ten_xt_b_${RUN_ID}`;
const WS_A = `ws_xt_a_${RUN_ID}`;
const WS_B = `ws_xt_b_${RUN_ID}`;

function adminHeaders(tenantId) {
  // Tenant-only gateway identity: x-tenant-id with NO x-workspace-id → not workspace-bound.
  return { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-auth-subject': `admin-${tenantId}` };
}

describe(
  'issue #517 fix-executor-apikey-cross-tenant-idor — REAL stack (executor HTTP + Postgres workspace_databases)',
  { skip: !RUN ? 'tests/env not running (set FALCONE_TESTENV=1 via source tests/env/env.sh)' : false },
  () => {
    let pool;
    let registry;
    let server;
    let baseUrl;

    before(async () => {
      pool = new Pool({ connectionString: DB_URL, max: 4 });

      // Seed the REAL workspace ownership registry the executor reads.
      await pool.query(`CREATE TABLE IF NOT EXISTS workspace_databases (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL UNIQUE,
        tenant_id TEXT NOT NULL,
        engine TEXT NOT NULL DEFAULT 'postgresql',
        database_name TEXT NOT NULL UNIQUE,
        mode TEXT NOT NULL DEFAULT 'shared',
        username TEXT NOT NULL DEFAULT 'falcone',
        host TEXT NOT NULL DEFAULT 'localhost',
        port INTEGER NOT NULL DEFAULT 5432,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by TEXT
      )`);
      await pool.query(
        `INSERT INTO workspace_databases (id, workspace_id, tenant_id, database_name)
         VALUES ($1,$2,$3,$4), ($5,$6,$7,$8)`,
        [`wdb_a_${RUN_ID}`, WS_A, TEN_A, `wsdb_a_${RUN_ID}`,
         `wdb_b_${RUN_ID}`, WS_B, TEN_B, `wsdb_b_${RUN_ID}`],
      );

      const apiKeyStore = createApiKeyStore({ pool });
      await apiKeyStore.ensureSchema();
      const resolveWorkspaceTenant = createWorkspaceTenantResolver({ pool });

      // Opening a data-plane connection during issuance/list would be a bug — throw to catch it.
      registry = createConnectionRegistry({
        resolveConnection: () => { throw new Error('registry.resolveConnection reached — ownership check must run first'); },
      });

      server = createControlPlaneServer({ registry, apiKeyStore, resolveWorkspaceTenant, logger: { error() {} } });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    after(async () => {
      try { if (server) await new Promise((r) => server.close(r)); } catch { /* noop */ }
      try { if (registry) await registry.end(); } catch { /* noop */ }
      try {
        if (pool) {
          await pool.query('DELETE FROM workspace_api_keys WHERE workspace_id = ANY($1)', [[WS_A, WS_B]]);
          await pool.query('DELETE FROM workspace_databases WHERE workspace_id = ANY($1)', [[WS_A, WS_B]]);
          await pool.end();
        }
      } catch { /* non-fatal */ }
    });

    // -----------------------------------------------------------------------
    // S-IDOR: cross-tenant issuance is rejected and persists nothing.
    // -----------------------------------------------------------------------
    it('S-IDOR: tenant-A admin minting an api-key in tenant-B workspace → 403 CROSS_TENANT_VIOLATION, no key persisted', async () => {
      const res = await fetch(`${baseUrl}/v1/workspaces/${WS_B}/api-keys`, {
        method: 'POST', headers: adminHeaders(TEN_A), body: JSON.stringify({ keyType: 'anon' }),
      });
      assert.equal(res.status, 403, `expected 403, got ${res.status}`);
      const body = await res.json();
      assert.equal(body.code, 'CROSS_TENANT_VIOLATION', `expected CROSS_TENANT_VIOLATION, got ${body.code}`);

      const persisted = await pool.query('SELECT count(*)::int AS n FROM workspace_api_keys WHERE workspace_id = $1', [WS_B]);
      assert.equal(persisted.rows[0].n, 0, 'no api key may be persisted for a foreign-tenant workspace');
    });

    // -----------------------------------------------------------------------
    // S-OWN: same-tenant issuance still succeeds (no regression).
    // -----------------------------------------------------------------------
    it('S-OWN: tenant-A admin minting an api-key in its OWN workspace → 201 with a flc_ key', async () => {
      const res = await fetch(`${baseUrl}/v1/workspaces/${WS_A}/api-keys`, {
        method: 'POST', headers: adminHeaders(TEN_A), body: JSON.stringify({ keyType: 'anon' }),
      });
      assert.equal(res.status, 201, `expected 201, got ${res.status}`);
      const body = await res.json();
      assert.match(body.key ?? '', /^flc_anon_/, 'a valid anon key must be returned for own-workspace issuance');

      const persisted = await pool.query(
        'SELECT tenant_id FROM workspace_api_keys WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 1', [WS_A]);
      assert.equal(persisted.rows[0]?.tenant_id, TEN_A, 'the persisted key is bound to tenant A');
    });

    // -----------------------------------------------------------------------
    // S-LIST: cross-tenant key management (list) is rejected too.
    // -----------------------------------------------------------------------
    it('S-LIST: tenant-A admin listing api-keys of tenant-B workspace → 403 CROSS_TENANT_VIOLATION', async () => {
      const res = await fetch(`${baseUrl}/v1/workspaces/${WS_B}/api-keys`, { headers: adminHeaders(TEN_A) });
      assert.equal(res.status, 403, `expected 403, got ${res.status}`);
      const body = await res.json();
      assert.equal(body.code, 'CROSS_TENANT_VIOLATION', `expected CROSS_TENANT_VIOLATION, got ${body.code}`);
    });
  },
);
