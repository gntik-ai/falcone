// #639 caller context must survive #972's authenticated invocation path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInvokeHeaders } from '../../apps/control-plane/function-executor.mjs';
import { createRuntimeServer } from '../../apps/fn-runtime/server.mjs';
import { invocationFixture, installInvocationFixture } from '../helpers/function-invocation-fixture.mjs';

const fixture = invocationFixture();
const target = { audience: 'fn-app-hello-abc', tenantId: 'ten-real', workspaceId: 'ws-real' };
const caller = {
  tenantId: 'ten-real', workspaceId: 'ws-real', principal: 'user-real',
  actorType: 'tenant_owner', roles: ['admin', 'dev'],
};
const runtimeEnv = {
  ...fixture.env, FN_INVOCATION_PRIVATE_KEY: undefined,
  K_SERVICE: target.audience, FN_TENANT_ID: target.tenantId, FN_WORKSPACE_ID: target.workspaceId,
};

async function postTo(t, headers, body, source) {
  const previous = process.env.FN_SRC;
  process.env.FN_SRC = source;
  t.after(() => {
    if (previous === undefined) delete process.env.FN_SRC;
    else process.env.FN_SRC = previous;
  });
  const server = createRuntimeServer(runtimeEnv);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
    t.skip('Sandbox forbids localhost listeners; run HTTP blackbox in PR CI');
    return null;
  }
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body,
    });
    return { statusCode: r.status, body: await r.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('bbx-639-hdr-01: executor signs verified caller and preserves rollout identity headers', (t) => {
  installInvocationFixture(t, fixture);
  const h = buildInvokeHeaders('{"n":1}', caller, target);
  assert.equal(h['x-falcone-tenant-id'], caller.tenantId);
  assert.equal(h['x-falcone-workspace-id'], caller.workspaceId);
  assert.equal(h['x-falcone-principal'], caller.principal);
  assert.equal(h['x-falcone-actor-type'], caller.actorType);
  assert.equal(h['x-falcone-roles'], 'admin,dev');
  assert.match(h.authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  assert.equal(h['content-type'], 'application/json');
  assert.equal(h['content-length'], 7);
});

test('bbx-639-hdr-02: absent caller still requires a signed target credential', (t) => {
  installInvocationFixture(t, fixture);
  const h = buildInvokeHeaders('{}', null, target);
  assert.ok(h.authorization);
  for (const k of Object.keys(h)) assert.ok(!k.startsWith('x-falcone-'));
  assert.throws(() => buildInvokeHeaders('{}', null), /signing is not configured/);
});

test('bbx-639-hdr-03: absent caller fields remain null in signed context', (t) => {
  installInvocationFixture(t, fixture);
  const h = buildInvokeHeaders('{}', { tenantId: 'ten-real', roles: [] }, target);
  assert.equal(h['x-falcone-tenant-id'], 'ten-real');
  assert.ok(!('x-falcone-workspace-id' in h));
  assert.ok(!('x-falcone-principal' in h));
  assert.ok(!('x-falcone-roles' in h));
});

test('bbx-639-rt-01: signed claims provide context; forged headers and body cannot spoof it', async (t) => {
  installInvocationFixture(t, fixture);
  const body = JSON.stringify({ n: 5, tenantId: 'SPOOF', principal: 'SPOOF' });
  const headers = buildInvokeHeaders(body, caller, target);
  headers['x-falcone-tenant-id'] = 'SPOOF';
  headers['x-falcone-principal'] = 'SPOOF';
  headers['x-falcone-roles'] = 'superadmin';
  const r = await postTo(t, headers, body,
    'function main(params, context){ return { gotParams: params, gotContext: context }; }');
  if (!r) return;
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.status, 'success');
  assert.deepEqual(r.body.result.gotContext, caller);
  assert.equal(r.body.result.gotParams.n, 5);
  assert.equal(r.body.result.gotParams.tenantId, 'SPOOF');
});

test('bbx-639-rt-02: signed invocation preserves single-arg main(params)', async (t) => {
  installInvocationFixture(t, fixture);
  const body = '{"n":4}';
  const r = await postTo(t, buildInvokeHeaders(body, caller, target), body,
    'function main(params){ return { doubled: (params.n||0)*2 }; }');
  if (!r) return;
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.status, 'success');
  assert.equal(r.body.result.doubled, 8);
});

test('bbx-972-rt-01: missing credential with forged identity never evaluates FN_SRC or main', async (t) => {
  delete globalThis.issue972Evaluated;
  delete globalThis.issue972Invoked;
  const r = await postTo(t, { 'x-falcone-tenant-id': 'ten-real', 'x-falcone-principal': 'admin' }, '{}',
    'globalThis.issue972Evaluated = true; function main(){ globalThis.issue972Invoked = true; }');
  if (!r) return;
  assert.equal(r.statusCode, 401);
  assert.equal(globalThis.issue972Evaluated, undefined);
  assert.equal(globalThis.issue972Invoked, undefined);
});
