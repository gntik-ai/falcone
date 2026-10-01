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
  assert.match(bearer, /issuer_base_url: "http:\/\/falcone-keycloak:8080"/);
  assert.match(bearer, /jwks_base_url: "http:\/\/falcone-keycloak:8080"/);
  assert.match(bearer, /platform_realm: "in-falcone-platform"/);
  assert.match(bearer, /audience: "in-falcone"/);
  assert.doesNotMatch(bearer, /issuers:/);
  assert.match(bearer, /cache_max_entries: 128/);
  for (const plugin of ['limit-count', 'client-control', 'request-validation', 'proxy-rewrite']) {
    assert.ok(bearer.includes(`${plugin}:`), `${plugin} missing`);
  }
  assert.match(bearer, /rejected_code: 429/);
  assert.match(bearer, /max_body_size: 1048576/);
  for (const header of ['x-tenant-id', 'x-workspace-id', 'x-auth-subject', 'x-actor-roles']) {
    assert.ok(bearer.includes(`- ${header}`), `${header} must be removed`);
  }
  assert.match(bearer, /X-Correlation-Id: \$http_x_correlation_id/);
  assert.match(bearer, /X-Request-Id: \$request_id/);
  assert.match(bearer, /x-gateway-auth: "\$\{\{GATEWAY_SHARED_SECRET\}\}"/);
});

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const chartPath = process.env.FALCONE_CHART_PATH ?? resolve(repoRoot, '../falcone-charts/charts/in-falcone');
const helmAvailable = spawnSync('helm', ['version', '--short'], { encoding: 'utf8' }).status === 0;

test('rendered chart and kind route 2006 agree on upstream, auth, and policy',
  { skip: !helmAvailable ? 'helm unavailable' : false }, () => {
    assert.ok(existsSync(chartPath), `chart missing at ${chartPath}; set FALCONE_CHART_PATH`);
    const standaloneRouteTable = readFileSync(resolve(chartPath, 'files/apisix/standalone/apisix.yaml'), 'utf8');
    assert.equal(routeTable, standaloneRouteTable, 'kind and chart standalone routes must be byte-identical');
    const rendered = spawnSync('helm', ['template', 'falcone', chartPath,
      '--namespace', 'falcone', '--show-only', 'templates/bootstrap-payload-configmap.yaml'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    assert.equal(rendered.status, 0, rendered.stderr);
    const afterRoute = rendered.stdout.split('  route-2006.json: |\n')[1];
    assert.ok(afterRoute, 'rendered route-2006.json missing');
    const chartRoute = JSON.parse(afterRoute.split(/\n  [\w.-]+: \|/)[0].replace(/^    /gm, ''));
    const kindRoute = route('2006');
    assert.equal(chartRoute.uri, '/v1/mongo/*');
    assert.equal(chartRoute.priority, Number(kindRoute.match(/priority: (\d+)/)[1]));
    assert.deepEqual(chartRoute.methods, JSON.parse(kindRoute.match(/methods: (\[[^\n]+\])/)[1]));
    assert.equal(chartRoute.plugins['openid-connect'], undefined);
    assert.match(kindRoute, /issuer-jwks-auth:/);
    assert.deepEqual(Object.keys(chartRoute.upstream.nodes),
      ['falcone-control-plane-executor.falcone.svc.cluster.local:8080']);
    assert.match(kindRoute, /falcone-control-plane-executor\.falcone\.svc\.cluster\.local:8080/);

    const plugins = chartRoute.plugins;
    const verifier = plugins['issuer-jwks-auth'];
    assert.ok(verifier);
    assert.equal(verifier.issuers, undefined);
    for (const field of ['issuer_base_url', 'jwks_base_url', 'platform_realm', 'audience']) {
      const value = kindRoute.match(new RegExp(`${field}: "([^"]+)"`));
      assert.ok(value, `${field} missing from kind route`);
      assert.equal(typeof verifier[field], 'string', `${field} missing from chart route`);
      if (field.endsWith('_url')) {
        const normalizedPath = (url) => new URL(url).pathname.replace(/^\/auth\/?$/, '/').replace(/\/$/, '');
        assert.equal(normalizedPath(verifier[field]), normalizedPath(value[1]), field);
      } else {
        assert.equal(verifier[field], value[1], field);
      }
    }
    assert.deepEqual(Object.keys(verifier).sort(),
      ['issuer_base_url', 'jwks_base_url', 'platform_realm', 'audience', 'cache_ttl', 'cache_max_entries', 'timeout'].sort());
    for (const field of ['cache_ttl', 'cache_max_entries', 'timeout']) {
      assert.equal(verifier[field], Number(kindRoute.match(new RegExp(`${field}: (\\d+)`))[1]), field);
    }

    assert.deepEqual(Object.keys(plugins).sort(),
      ['issuer-jwks-auth', 'cors', 'limit-count', 'client-control', 'request-validation', 'proxy-rewrite'].sort());
    for (const name of ['cors', 'limit-count', 'client-control', 'request-validation', 'proxy-rewrite']) {
      assert.ok(plugins[name], `${name} missing from chart`);
      assert.ok(kindRoute.includes(`${name}:`), `${name} missing from kind`);
    }
    for (const field of ['count', 'time_window', 'rejected_code']) {
      assert.equal(plugins['limit-count'][field],
        Number(kindRoute.match(new RegExp(`${field}: (\\d+)`))[1]), field);
    }
    for (const field of ['key', 'key_type']) {
      assert.equal(plugins['limit-count'][field], kindRoute.match(new RegExp(`${field}: ([^\\n]+)`))[1], field);
    }
    assert.equal(plugins['client-control'].max_body_size,
      Number(kindRoute.match(/max_body_size: (\d+)/)[1]));
    assert.deepEqual(plugins['request-validation'].header_schema.required,
      JSON.parse(kindRoute.match(/required: (\[[^\n]+\])/)[1]));
    for (const header of ['X-Tenant-Id', 'X-Workspace-Id', 'X-Auth-Subject', 'X-Actor-Roles']) {
      assert.equal(plugins['request-validation'].header_schema.properties[header].maxLength, 0);
      assert.match(kindRoute, new RegExp(`${header}: \\{ type: string, maxLength: 0 \\}`));
      assert.ok(plugins['proxy-rewrite'].headers.remove.includes(header.toLowerCase()));
      assert.ok(kindRoute.includes(`- ${header.toLowerCase()}`));
    }
    const chartHeaders = plugins['proxy-rewrite'].headers.set;
    for (const header of ['X-Correlation-Id', 'X-Request-Id', 'x-gateway-auth']) {
      assert.ok(kindRoute.includes(`${header}: ${header === 'x-gateway-auth' ? '"' : ''}${chartHeaders[header]}`));
    }
    assert.deepEqual(Object.keys(chartHeaders).sort(),
      ['X-Correlation-Id', 'X-Request-Id', 'x-gateway-auth'].sort());
  });

test('kind APISIX pod mounts the Mongo verifier and its enabled plugin config',
  { skip: !helmAvailable ? 'helm unavailable' : false }, () => {
    assert.ok(existsSync(chartPath), `chart missing at ${chartPath}; set FALCONE_CHART_PATH`);
    const kindValues = resolve(chartPath, '../../deploy/kind/values-kind.yaml');
    assert.ok(existsSync(kindValues), `kind values missing at ${kindValues}`);
    const rendered = spawnSync('helm', ['template', 'falcone', chartPath,
      '--namespace', 'falcone', '-f', kindValues,
      '--show-only', 'charts/apisix/templates/workload.yaml'],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    assert.equal(rendered.status, 0, rendered.stderr);
    const pod = rendered.stdout;
    const podVolumes = pod.split('\n      volumes:\n')[1];
    assert.ok(podVolumes, 'kind APISIX pod has no volumes');
    for (const name of ['standalone-config', 'apisix-config-source', 'apisix-config-overlay', 'issuer-jwks-auth']) {
      assert.match(podVolumes, new RegExp(`name: ${name}(?:\\n|$)`), `${name} volume missing`);
    }
    for (const name of ['apisix-config-source', 'apisix-config-overlay']) {
      assert.match(pod, new RegExp(`mountPath: [^\\n]+\\n\\s+name: ${name}`), `${name} init mount missing`);
    }
    assert.match(pod, /mountPath: \/usr\/local\/apisix\/conf\/config\.yaml\n\s+name: apisix-config-overlay/);
    assert.match(pod, /mountPath: \/usr\/local\/apisix\/falcone\/apisix\/plugins\/issuer-jwks-auth\.lua\n\s+name: issuer-jwks-auth/);
  });
