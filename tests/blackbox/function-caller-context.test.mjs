// bbx-function-caller-context
//
// Black-box coverage for change add-function-caller-context (GitHub #639).
//
// A function invocation must deliver a VERIFIED, tamper-proof caller context
// (tenant/workspace/principal/roles) to the function, out-of-band from the
// user-controlled payload. The control-plane executor injects it as X-Falcone-*
// headers (built from the verified identity); the fn-runtime reads it from those
// HEADERS (never the body) and passes it to user code as `main(params, context)`.
//
// Send side (executor):   buildInvokeHeaders(payload, caller)
// Receive side (runtime):  callerContextFromHeaders(headers) + main(params, context)
//
// Scenarios:
//   bbx-639-hdr-01..03  executor injects X-Falcone-* from the caller (omits absent fields)
//   bbx-639-ctx-01..02  fn-runtime maps headers -> context
//   bbx-639-rt-01       end-to-end: context comes from headers, the body cannot spoof it
//   bbx-639-rt-02       backward compatible: a single-arg main(params) still succeeds
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInvokeHeaders } from '../../deploy/kind/control-plane/function-executor.mjs';

const FN = '../../deploy/kind/fn-runtime/server.mjs';

test('bbx-639-hdr-01: buildInvokeHeaders injects X-Falcone-* from the verified caller', () => {
  const h = buildInvokeHeaders('{"n":1}', { tenantId: 'ten-a', workspaceId: 'ws-a', principal: 'user-a', actorType: 'tenant_owner', roles: ['admin', 'dev'] });
  assert.equal(h['x-falcone-tenant-id'], 'ten-a');
  assert.equal(h['x-falcone-workspace-id'], 'ws-a');
  assert.equal(h['x-falcone-principal'], 'user-a');
  assert.equal(h['x-falcone-actor-type'], 'tenant_owner');
  assert.equal(h['x-falcone-roles'], 'admin,dev');
  assert.equal(h['content-type'], 'application/json');
  assert.ok(Number(h['content-length']) > 0);
});

test('bbx-639-hdr-02: no caller -> no identity headers (unchanged behaviour)', () => {
  const h = buildInvokeHeaders('{}', null);
  for (const k of Object.keys(h)) assert.ok(!k.startsWith('x-falcone-'), `${k} must not be present`);
});

test('bbx-639-hdr-03: absent/empty caller fields are omitted, not sent blank', () => {
  const h = buildInvokeHeaders('{}', { tenantId: 'ten-a', workspaceId: null, principal: '', roles: [] });
  assert.equal(h['x-falcone-tenant-id'], 'ten-a');
  assert.ok(!('x-falcone-workspace-id' in h), 'null workspace omitted');
  assert.ok(!('x-falcone-principal' in h), 'empty principal omitted');
  assert.ok(!('x-falcone-roles' in h), 'empty roles omitted');
});

test('bbx-639-ctx-01: callerContextFromHeaders maps X-Falcone-* headers to a context object', async () => {
  const { callerContextFromHeaders } = await import(FN);
  const c = callerContextFromHeaders({
    'x-falcone-tenant-id': 'ten-a', 'x-falcone-workspace-id': 'ws-a', 'x-falcone-principal': 'user-a',
    'x-falcone-actor-type': 'tenant_owner', 'x-falcone-roles': 'a,b',
  });
  assert.deepEqual(c, { tenantId: 'ten-a', workspaceId: 'ws-a', principal: 'user-a', actorType: 'tenant_owner', roles: ['a', 'b'] });
});

test('bbx-639-ctx-02: missing identity headers -> null fields + empty roles', async () => {
  const { callerContextFromHeaders } = await import(FN);
  assert.deepEqual(callerContextFromHeaders({}), { tenantId: null, workspaceId: null, principal: null, actorType: null, roles: [] });
});

async function postTo(server, headers, body) {
  await new Promise((res) => server.listen(0, res));
  try {
    const port = server.address().port;
    const r = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return await r.json();
  } finally {
    await new Promise((res) => server.close(res));
  }
}

test('bbx-639-rt-01: fn-runtime passes a HEADER-derived context to main(params, context); the body cannot spoof it', async () => {
  process.env.FN_SRC = 'function main(params, context){ return { gotParams: params, gotContext: context }; }';
  const { server } = await import(FN);
  const j = await postTo(server, {
    'x-falcone-tenant-id': 'ten-real', 'x-falcone-workspace-id': 'ws-real', 'x-falcone-principal': 'user-real',
    'x-falcone-actor-type': 'tenant_owner', 'x-falcone-roles': 'admin,dev',
  }, { n: 5, tenantId: 'SPOOF', principal: 'SPOOF' });
  assert.equal(j.status, 'success');
  assert.equal(j.result.gotContext.tenantId, 'ten-real', 'context tenant comes from the header, not the body');
  assert.equal(j.result.gotContext.workspaceId, 'ws-real');
  assert.equal(j.result.gotContext.principal, 'user-real');
  assert.deepEqual(j.result.gotContext.roles, ['admin', 'dev']);
  assert.equal(j.result.gotParams.n, 5, 'params reach the function intact');
  assert.equal(j.result.gotParams.tenantId, 'SPOOF', 'a body field stays in params only — never in context');
});

test('bbx-639-rt-02: backward compatible — a single-arg main(params) still succeeds', async () => {
  process.env.FN_SRC = 'function main(params){ return { doubled: (params.n||0)*2 }; }';
  const { server } = await import(FN);
  const j = await postTo(server, { 'x-falcone-tenant-id': 'ten-x' }, { n: 4 });
  assert.equal(j.status, 'success');
  assert.equal(j.result.doubled, 8);
});
