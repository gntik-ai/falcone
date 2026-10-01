import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const routeTable = readFileSync(new URL('../../deploy/kind/apisix/apisix.yaml', import.meta.url), 'utf8');
const route = (id) => {
  const start = routeTable.indexOf(`  - id: "${id}"\n`);
  assert.notEqual(start, -1, `missing route ${id}`);
  const end = routeTable.indexOf('\n  - id: ', start + 1);
  return routeTable.slice(start, end < 0 ? undefined : end);
};

test('Mongo bearer route selects the executor while the API-key route keeps precedence', () => {
  const bearer = route('2006');
  const apikey = route('2006-key');
  assert.match(bearer, /uri: "\/v1\/mongo\/\*"/);
  assert.match(bearer, /falcone-control-plane-executor\.falcone\.svc\.cluster\.local:8080/);
  assert.match(apikey, /falcone-control-plane-executor\.falcone\.svc\.cluster\.local:8080/);
  assert.ok(Number(apikey.match(/priority: (\d+)/)[1]) > Number(bearer.match(/priority: (\d+)/)[1]));
  assert.match(apikey, /\["http_apikey", "~~", "\^flc_"\]/);
  assert.match(apikey, /key: \$http_apikey/);
  assert.match(apikey, /rejected_code: 429/);
});

test('Mongo bearer route requires explicit issuer verification and keeps gateway policy', () => {
  const bearer = route('2006');
  assert.match(bearer, /issuer-jwks-auth:/);
  assert.doesNotMatch(bearer, /openid-connect:/);
  assert.match(bearer, /issuers:\s*\n\s*- issuer: "http:\/\/falcone-keycloak:8080\/realms\/in-falcone-platform"/);
  assert.match(bearer, /cache_max_entries: 128/);
  for (const plugin of ['limit-count', 'client-control', 'request-validation', 'proxy-rewrite']) {
    assert.ok(bearer.includes(`${plugin}:`), `${plugin} missing`);
  }
  assert.match(bearer, /rejected_code: 429/);
  assert.match(bearer, /max_body_size: 262144/);
  for (const header of ['x-tenant-id', 'x-workspace-id', 'x-auth-subject', 'x-actor-roles']) {
    assert.ok(bearer.includes(`${header}: ""`), `${header} must be removed`);
  }
  assert.match(bearer, /X-Correlation-Id: \$http_x_correlation_id/);
  assert.match(bearer, /X-Request-Id: \$request_id/);
  assert.match(bearer, /x-gateway-auth: "\$\{\{GATEWAY_SHARED_SECRET\}\}"/);
});

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const chartPath = process.env.FALCONE_CHART_PATH ?? resolve(repoRoot, '../falcone-charts/charts/in-falcone');
const helmAvailable = spawnSync('helm', ['version', '--short'], { encoding: 'utf8' }).status === 0;

test('rendered chart and kind route 2006 use the same Mongo auth plugin and executor upstream',
  { skip: !existsSync(chartPath) || !helmAvailable ? 'chart or helm unavailable' : false }, () => {
    const rendered = spawnSync('helm', ['template', 'falcone', chartPath,
      '--namespace', 'falcone', '--show-only', 'templates/bootstrap-payload-configmap.yaml'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    assert.equal(rendered.status, 0, rendered.stderr);
    const afterRoute = rendered.stdout.split('  route-2006.json: |\n')[1];
    assert.ok(afterRoute, 'rendered route-2006.json missing');
    const chartRoute = JSON.parse(afterRoute.split(/\n  [\w.-]+: \|/)[0].replace(/^    /gm, ''));
    const kindRoute = route('2006');
    assert.equal(chartRoute.uri, '/v1/mongo/*');
    assert.ok(chartRoute.plugins['issuer-jwks-auth']);
    assert.equal(chartRoute.plugins['openid-connect'], undefined);
    assert.match(kindRoute, /issuer-jwks-auth:/);
    assert.deepEqual(Object.keys(chartRoute.upstream.nodes),
      ['falcone-control-plane-executor.falcone.svc.cluster.local:8080']);
    assert.match(kindRoute, /falcone-control-plane-executor\.falcone\.svc\.cluster\.local:8080/);
  });
