import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const writes = [
  ['POST', '/v1/workspaces/{id}/llm-providers'],
  ['PUT', '/v1/workspaces/{id}/llm-providers/{connectionId}'],
  ['DELETE', '/v1/workspaces/{id}/llm-providers/{connectionId}'],
];

test('the three connection writes are catalogued as structural_admin', () => {
  const catalog = JSON.parse(readFileSync(new URL('../../deploy/gateway-config/public-route-catalog.json', import.meta.url)));
  for (const [method, path] of writes) {
    const entries = catalog.filter(r => r.method === method && r.path === path);
    assert.equal(entries.length, 1, `${method} ${path}`);
    assert.equal(entries[0].privilege_domain, 'structural_admin');
  }
});

test('new paths already match the deployment chart 2003-llm route', () => {
  const chartRoot = process.env.FALCONE_CHART_PATH ?? '../falcone-charts/charts/in-falcone';
  const source = readFileSync(resolve(chartRoot, 'files/apisix/standalone/apisix.yaml'), 'utf8');
  const block = source.split('  - id: "2003-llm"')[1]?.split('\n  - id: ')[0];
  assert.ok(block, '2003-llm route exists');
  const pattern = JSON.parse(block.match(/- (\["uri", "~~", .*\])/)[1])[2];
  for (const [, path] of writes) assert.match(path.replace('{id}', 'shared').replace('{connectionId}', 'openai-main'), new RegExp(pattern));
});
