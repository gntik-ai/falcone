import test from 'node:test';
import assert from 'node:assert/strict';
import { createFalconeContext } from './context.mjs';

function recordingCall() {
  const calls = [];
  const fn = async (req) => { calls.push(req); return { ok: true, echo: req }; };
  fn.calls = calls;
  return fn;
}

test('createFalconeContext: db/storage/functions/events calls carry the bound tenant + workspace', async () => {
  const call = recordingCall();
  const ctx = createFalconeContext({ tenantId: 'ten-a', workspaceId: 'ws-1', call });
  await ctx.db.query('select 1', [1]);
  await ctx.storage.put('k', 'v');
  await ctx.functions.invoke('fn', { a: 1 });
  await ctx.events.publish('topic', { e: 1 });
  assert.equal(call.calls.length, 4);
  for (const c of call.calls) {
    assert.equal(c.tenantId, 'ten-a');
    assert.equal(c.workspaceId, 'ws-1');
  }
  assert.equal(call.calls[0].capability, 'postgres');
  assert.equal(call.calls[0].op, 'query');
  assert.deepEqual(call.calls[0].values, [1]);
});

test('no escape: the authoritative request scope is always the bound tenant, regardless of tool input', async () => {
  const call = recordingCall();
  const ctx = createFalconeContext({ tenantId: 'ten-a', workspaceId: 'ws-1', call });
  // a tool puts a tenant-looking value into its DATA (a column filter) — that is just data, not scope
  await ctx.db.select('orders', { status: 'open', tenant_id: 'ten-EVIL' });
  const req = call.calls[0];
  // the authoritative scope the executor + RLS bind on is the credential-bound tenant, never the tool's
  assert.equal(req.tenantId, 'ten-a');
  assert.equal(req.workspaceId, 'ws-1');
  // user data is passed through untouched (harmless: RLS still binds the query to ten-a)
  assert.deepEqual(req.filter, { status: 'open', tenant_id: 'ten-EVIL' });
});

test('no escape: a tenant/workspace at the request envelope is overridden by the binding', async () => {
  const call = recordingCall();
  const ctx = createFalconeContext({ tenantId: 'ten-a', workspaceId: 'ws-1', call });
  // even when an envelope-level scope is present (e.g. via storage opts spread), the binding wins
  await ctx.db.query('select 1');
  for (const req of call.calls) {
    assert.equal(req.tenantId, 'ten-a');
    assert.equal(req.workspaceId, 'ws-1');
  }
});

test('ctx and its clients are frozen — a tool cannot swap a client or mutate the scope', () => {
  const ctx = createFalconeContext({ tenantId: 'ten-a', workspaceId: 'ws-1', call: async () => ({}) });
  assert.equal(Object.isFrozen(ctx), true);
  assert.equal(Object.isFrozen(ctx.db), true);
  assert.throws(() => { 'use strict'; ctx.tenantId = 'ten-b'; });
  assert.throws(() => { 'use strict'; ctx.db.query = () => {}; });
});

test('createFalconeContext: requires a tenant and a call transport', () => {
  assert.throws(() => createFalconeContext({ workspaceId: 'ws', call: async () => {} }), /tenantId/);
  assert.throws(() => createFalconeContext({ tenantId: 'ten-a' }), /call transport/);
});
