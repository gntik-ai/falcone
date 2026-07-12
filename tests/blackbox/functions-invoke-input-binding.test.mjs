// Black-box tests for change fix-functions-invoke-input-binding (#570).
//
// The OpenAPI FunctionInvocationWriteRequest documents the body `{ parameters: {...} }`, but the
// two invoke surfaces bound the input INCONSISTENTLY:
//   - kind fn-handlers.fnInvoke read `body.parameters ?? {}` → a top-level body like {n:21} was
//     silently dropped to {} → {doubled:0} (wrong answer, no error).
//   - the executor (functions-executor) passed the WHOLE body to the backend → the documented
//     `{parameters:{n:21}}` reached the function as {parameters:{n:21}} (so p.n was undefined).
//
// The fix gives both surfaces one binding (`invocationInput`): unwrap the documented `parameters`
// envelope when present, otherwise honor a bare top-level input map (never silently drop it);
// envelope-only keys are never passed as function input.
//
// The executor side is driven through createFunctionsExecutor with a capturing backend stub (the
// binding is what we assert; the backend's actual execution is out of scope). The kind side is
// asserted on the exported pure `invocationInput` binding (the Knative path isn't exercised here).
//
// bbx-fn-invoke-01 .. bbx-fn-invoke-04
import test from 'node:test';
import assert from 'node:assert/strict';

import { createFunctionsExecutor } from '../../apps/control-plane-executor/src/runtime/functions-executor.mjs';
import { invocationInput as kindInvocationInput } from '../../apps/control-plane/fn-handlers.mjs';

const IDENT = { tenantId: 'ten_fn', workspaceId: 'ws_fn' };
const SRC = 'function main(p){ return { doubled: (p.n||0)*2 }; }';

// Deploy a function then invoke it with `body`, capturing the params the backend receives.
async function invokeWith(body) {
  const captured = {};
  const backend = {
    async invoke(_source, params) { captured.params = params; return { ok: true, result: params, logs: [] }; },
  };
  const ex = createFunctionsExecutor({ backend });
  await ex.executeFunctions({ operation: 'deploy', workspaceId: 'ws_fn', identity: IDENT, name: 'd', payload: { name: 'd', source: SRC } });
  await ex.executeFunctions({ operation: 'invoke', workspaceId: 'ws_fn', identity: IDENT, name: 'd', payload: body });
  return captured.params;
}

test('bbx-fn-invoke-01: documented {parameters:{...}} envelope is unwrapped for the function', async () => {
  assert.deepEqual(await invokeWith({ parameters: { n: 21 } }), { n: 21 });
});

test('bbx-fn-invoke-02: bare top-level input is honored (not silently dropped)', async () => {
  assert.deepEqual(await invokeWith({ n: 21 }), { n: 21 });
});

test('bbx-fn-invoke-03: empty body → empty params (no crash)', async () => {
  assert.deepEqual(await invokeWith({}), {});
});

test('bbx-fn-invoke-04: kind invocationInput binding parity', () => {
  assert.deepEqual(kindInvocationInput({ parameters: { n: 21 } }), { n: 21 }, 'documented envelope unwrapped');
  assert.deepEqual(kindInvocationInput({ n: 21 }), { n: 21 }, 'top-level input honored');
  assert.deepEqual(kindInvocationInput({ responseMode: 'wait_for_result' }), {}, 'envelope-only keys are not input');
  assert.deepEqual(kindInvocationInput({}), {}, 'empty body → empty params');
  assert.deepEqual(kindInvocationInput(undefined), {}, 'missing body → empty params');
});
