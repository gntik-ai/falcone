// fix-workspace-environment-enum-parity (#637)
//
// The live workspace `environment` catalog is dev|staging|prod|sandbox|preview, but the published
// OpenAPI `WorkspaceEnvironment` enum omitted `preview` — a client generated from the spec would
// reject a valid `preview` value (spec/implementation drift). Pure: reads the OpenAPI document and
// the live ENVIRONMENT_CATALOG literal; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const openapi = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../apps/control-plane-executor/openapi/control-plane.openapi.json', import.meta.url)), 'utf8'),
);
const bHandlersSrc = readFileSync(
  fileURLToPath(new URL('../../apps/control-plane/b-handlers.mjs', import.meta.url)), 'utf8',
);

// Extract the live catalog literal so the test catches future drift in EITHER direction.
function liveEnvironmentCatalog() {
  const m = /const ENVIRONMENT_CATALOG\s*=\s*(\[[^\]]*\])/.exec(bHandlersSrc);
  assert.ok(m, 'ENVIRONMENT_CATALOG literal found in b-handlers.mjs');
  return JSON.parse(m[1].replace(/'/g, '"'));
}

test('bbx-env-enum-01: OpenAPI WorkspaceEnvironment enum lists every live environment value (incl. preview)', () => {
  const enumVals = openapi.components.schemas.WorkspaceEnvironment.enum;
  const catalog = liveEnvironmentCatalog();
  assert.ok(catalog.includes('preview'), 'precondition: the live catalog includes preview');
  for (const v of catalog) {
    assert.ok(enumVals.includes(v), `OpenAPI WorkspaceEnvironment enum is missing live environment '${v}'`);
  }
  // The specific drift this change closes:
  assert.ok(enumVals.includes('preview'), 'OpenAPI enum includes preview (#637)');
});
