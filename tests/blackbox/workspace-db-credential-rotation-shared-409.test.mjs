/**
 * Black-box tests for add-rotatable-workspace-db-credential (GitHub issue #686, enhancement).
 *
 * Defect/gap: `POST /v1/workspaces/{ws}/database/credential-rotations` returned a success-shaped
 * `200 {rotated:false}` for every workspace in `shared` mode (no dedicated credential to rotate),
 * so the caller/UI could not tell that NO rotation occurred. The fix makes shared mode return a
 * non-success `409 DB_SHARED_MODE` carrying the reason, while the dedicated path keeps returning
 * `201` with the freshly-rotated credential.
 *
 * This suite drives the PUBLIC handler surface deterministically (no DB) via the
 * ctx.store / ctx.rotateWorkspaceDatabaseCredential DI seams, mirroring sa-delete.test.mjs:
 *   bbx-686-01  shared-mode rotation -> 409 DB_SHARED_MODE carrying the reason (Scenario: honest non-success)
 *   bbx-686-02  dedicated-mode rotation -> 201 with the new credential/DSN (Scenario: dedicated)
 *   bbx-686-03  the rotation is performed on the workspace's OWN database row (rotate fn args)
 *   bbx-686-04  cross-tenant caller -> 403, and the rotate fn is NEVER invoked (isolation, gate first)
 *   bbx-686-05  workspace with no provisioned database -> 404 DB_NOT_PROVISIONED (no rotate call)
 *   bbx-686-06  a rotate-function failure -> 502 ROTATE_DB_FAILED (not a leaked 500)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { LOCAL_HANDLERS } from '../../deploy/kind/control-plane/b-handlers.mjs';

// ---- handler harness: inject store + rotate fn via ctx (parity with the SA-delete suite) ------
function handlerCtx(overrides = {}) {
  const calls = { rotate: [], getWorkspaceDatabase: [] };
  const dbRow = overrides.dbRow === null
    ? null
    : {
        id: 'db-uuid-1', workspace_id: 'ws-1', tenant_id: 'ten-1',
        engine: 'postgresql', database_name: 'wsdb_acme_w', mode: 'shared', username: 'falcone',
        ...overrides.dbRow,
      };
  const store = {
    async getWorkspace() { return { id: 'ws-1', tenant_id: 'ten-1', slug: 'acme' }; },
    async getTenant() { return { id: 'ten-1', iam_realm: 'ten-1' }; },
    async getWorkspaceDatabase(_p, wsId) { calls.getWorkspaceDatabase.push(wsId); return dbRow; },
    ...overrides.store,
  };
  // Default rotate fn echoes the discriminated contract of dataplane.mjs based on the row's mode.
  const rotateWorkspaceDatabaseCredential = overrides.rotate ?? (async (_pool, args) => {
    calls.rotate.push(args);
    if (args.mode !== 'dedicated_role' || !args.username) {
      return { rotated: false, reason: 'shared-mode database has no dedicated credential to rotate' };
    }
    return {
      rotated: true, mode: args.mode, database: args.database, host: 'falcone-postgresql', port: 5432,
      username: args.username, password: 'newpass0123456789abcdef0123456789',
      dsn: `postgresql://${args.username}:newpass0123456789abcdef0123456789@falcone-postgresql:5432/${args.database}`,
    };
  });
  // Wrap a caller-supplied rotate fn so we still record invocations for assertions.
  const rotateWrapped = overrides.rotate
    ? (async (...a) => { calls.rotate.push(a[1]); return overrides.rotate(...a); })
    : rotateWorkspaceDatabaseCredential;

  return {
    calls, dbRow,
    ctx: {
      pool: {}, store, rotateWorkspaceDatabaseCredential: rotateWrapped,
      identity: overrides.identity ?? { sub: 'owner-1', actorType: 'tenant_owner', tenantId: 'ten-1' },
      params: { workspaceId: 'ws-1' },
      body: {},
    },
  };
}

test('bbx-686-01 shared-mode rotation returns 409 DB_SHARED_MODE (not 200) carrying the reason', async () => {
  const { ctx, calls } = handlerCtx({ dbRow: { mode: 'shared', username: 'falcone' } });
  const res = await LOCAL_HANDLERS.rotateDatabaseCredential(ctx);

  assert.equal(res.statusCode, 409, 'shared mode must be a non-success 409, not a 200');
  assert.equal(res.body.code, 'DB_SHARED_MODE');
  assert.match(res.body.message, /dedicated credential/i, 'the reason explains why nothing rotated');
  assert.equal(res.body.rotated, undefined, 'no success-shaped {rotated:false} body');
  assert.equal(calls.rotate.length, 1, 'the rotate function was consulted (and reported no-op)');
});

test('bbx-686-02 dedicated-mode rotation returns 201 with the new credential/DSN', async () => {
  const { ctx } = handlerCtx({ dbRow: { mode: 'dedicated_role', username: 'wsdb_acme_w_app' } });
  const res = await LOCAL_HANDLERS.rotateDatabaseCredential(ctx);

  assert.equal(res.statusCode, 201, 'dedicated rotation is a created-resource 201');
  assert.equal(res.body.rotated, true);
  assert.equal(res.body.databaseId, 'db-uuid-1');
  assert.equal(res.body.username, 'wsdb_acme_w_app');
  assert.ok(res.body.password && res.body.password.length >= 16, 'a new password is surfaced');
  assert.ok(res.body.dsn?.includes(res.body.password), 'the DSN embeds the new password');
});

test('bbx-686-03 rotation targets the workspace OWN database row', async () => {
  const { ctx, calls } = handlerCtx({ dbRow: { mode: 'dedicated_role', username: 'wsdb_acme_w_app', database_name: 'wsdb_acme_w' } });
  await LOCAL_HANDLERS.rotateDatabaseCredential(ctx);

  assert.deepEqual(calls.getWorkspaceDatabase, ['ws-1'], 'looked up the active workspace database');
  assert.equal(calls.rotate[0].database, 'wsdb_acme_w', 'rotated the workspace own database');
  assert.equal(calls.rotate[0].mode, 'dedicated_role');
  assert.equal(calls.rotate[0].username, 'wsdb_acme_w_app');
});

test('bbx-686-04 cross-tenant caller is 403 and the rotate function is never invoked (isolation)', async () => {
  const { ctx, calls } = handlerCtx({
    dbRow: { mode: 'dedicated_role', username: 'wsdb_acme_w_app' },
    identity: { sub: 'intruder', actorType: 'tenant_owner', tenantId: 'other-tenant' },
  });
  const res = await LOCAL_HANDLERS.rotateDatabaseCredential(ctx);

  assert.equal(res.statusCode, 403, 'a caller who does not own the tenant is forbidden');
  assert.equal(res.body.code, 'FORBIDDEN');
  assert.equal(calls.rotate.length, 0, 'no rotation is attempted for a foreign workspace');
});

test('bbx-686-05 unprovisioned workspace is 404 DB_NOT_PROVISIONED (no rotation)', async () => {
  const { ctx, calls } = handlerCtx({ dbRow: null });
  const res = await LOCAL_HANDLERS.rotateDatabaseCredential(ctx);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'DB_NOT_PROVISIONED');
  assert.equal(calls.rotate.length, 0, 'nothing to rotate when there is no database');
});

test('bbx-686-06 a rotate-function failure surfaces as 502 ROTATE_DB_FAILED (no leaked 500)', async () => {
  const { ctx } = handlerCtx({
    dbRow: { mode: 'dedicated_role', username: 'wsdb_acme_w_app' },
    rotate: async () => { throw new Error('ALTER ROLE blew up'); },
  });
  const res = await LOCAL_HANDLERS.rotateDatabaseCredential(ctx);

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, 'ROTATE_DB_FAILED');
});
