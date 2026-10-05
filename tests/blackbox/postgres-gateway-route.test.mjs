import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const routeTable = readFileSync(new URL('../../deploy/kind/apisix/apisix.yaml', import.meta.url), 'utf8');
const route = (id) => {
  const start = routeTable.indexOf(`  - id: "${id}"\n`);
  assert.notEqual(start, -1, `missing route ${id}`);
  const end = routeTable.indexOf('\n  - id: ', start + 1);
  return routeTable.slice(start, end < 0 ? undefined : end);
};
const priority = (block) => Number(block.match(/priority: (\d+)/)[1]);
const methods = (block) => {
  const match = block.match(/methods: (\[[^\n]+\])/);
  return match ? JSON.parse(match[1]) : null;
};
const vars = (block) => [...block.matchAll(/^      - (\[[^\n]+\])$/gm)]
  .map((match) => JSON.parse(match[1]));
const routes = [...routeTable.split('\nglobal_rules:')[0].matchAll(/^  - id: "([^"]+)"$/gm)]
  .map((match) => ({ id: match[1], block: route(match[1]) }))
  .sort((a, b) => priority(b.block) - priority(a.block));

// Include every route, so a competing URI or catch-all cannot hide behind a Postgres-only filter.
// Model the table's exact/prefix-wildcard URIs, method restrictions, priority, and regex vars.
// JWT validation happens after selection: absent/invalid tokens must still reach the verifier.
function selectRoute(method, uri, headers = {}) {
  return routes.find(({ block }) => {
    const declaredUri = JSON.parse(block.match(/^    uri: ("[^\n]+")$/m)[1]);
    const uriMatches = declaredUri.endsWith('*')
      ? uri.startsWith(declaredUri.slice(0, -1)) : uri === declaredUri;
    return uriMatches
      && (methods(block) === null || methods(block).includes(method))
      && vars(block).every(([name, operator, pattern]) => {
        assert.equal(operator, '~~');
        const value = name === 'uri' ? uri : headers[name.slice('http_'.length)] ?? '';
        return new RegExp(pattern).test(value);
      });
  });
}

const tablePath = '/v1/postgres/workspaces/workspace-example/data/database-example/schemas/public/tables/table-example';
const operations = [
  ['GET', 'rows'], ['POST', 'rows'],
  ['GET', 'rows/by-primary-key'], ['PATCH', 'rows/by-primary-key'], ['DELETE', 'rows/by-primary-key'],
  ['POST', 'bulk/insert'], ['POST', 'rows/bulk/insert'], ['POST', 'search'],
  ['PUT', 'embedding-mapping'], ['GET', 'embedding-mapping'], ['DELETE', 'embedding-mapping'],
];

test('Postgres data paths select the executor for bearer, absent, and invalid tokens', () => {
  const bearer = route('2005-data');
  assert.match(bearer, /uri: "\/v1\/postgres\/\*"/);
  assert.ok(priority(route('2005')) < priority(bearer));
  assert.ok(priority(bearer) < priority(route('2005-key')));
  assert.deepEqual(vars(bearer).map(([name, operator]) => [name, operator]), [['uri', '~~']]);
  const pattern = vars(bearer)[0][2];
  assert.ok(pattern.startsWith('^') && pattern.endsWith('$'), 'data path regex must be anchored');
  for (const [method, suffix] of operations) {
    for (const headers of [{ authorization: 'Bearer test-token' }, {}, { authorization: 'Bearer invalid' }]) {
      const selected = selectRoute(method, `${tablePath}/${suffix}`, headers);
      assert.equal(selected?.id, '2005-data', `${method} ${suffix}`);
      assert.match(selected.block, /falcone-control-plane-executor\.falcone\.svc\.cluster\.local:8080/);
      assert.match(selected.block, /issuer-jwks-auth:/);
    }
  }
});

test('Postgres API keys keep route 2005-key and its per-key limit policy', () => {
  for (const [method, suffix] of operations) {
    assert.equal(selectRoute(method, `${tablePath}/${suffix}`, {
      apikey: 'flc_test_only', authorization: 'Bearer test-token',
    })?.id, '2005-key');
  }
  const apikey = route('2005-key');
  assert.deepEqual(vars(apikey), [['http_apikey', '~~', '^flc_']]);
  assert.equal(priority(apikey), 335);
  assert.match(apikey, /falcone-control-plane-executor\.falcone\.svc\.cluster\.local:8080/);
  assert.match(apikey, /count: 120\n        time_window: 60\n        rejected_code: 429/);
  assert.match(apikey, /key_type: var_combination\n        key: \$http_apikey\n        allow_degradation: false/);
});

test('Postgres data regex leaves introspection, exports, imports, and unsupported suffixes on 2005', () => {
  const paths = [
    ['POST', `${tablePath}/exports`], ['POST', `${tablePath}/imports`],
    ['GET', '/v1/postgres/databases/database-example/schemas'],
    ['GET', '/v1/postgres/databases/database-example/schemas/public/tables'],
    ['GET', '/v1/postgres/databases/database-example/schemas/public/tables/table-example/columns'],
  ];
  const unsupportedPaths = [
    `${tablePath}/rows/extra`, `${tablePath}/rows/by-primary-key/extra`,
    `${tablePath}/rows/`, `${tablePath}/bulk/insert/extra`, `${tablePath}/search/extra`,
    `${tablePath}/embedding-mapping/extra`, `${tablePath}/bulk/update`, `${tablePath}/bulk/delete`,
    `${tablePath}/rpc`, `${tablePath}/credentials`,
    '/v1/postgres/data/database-example/schemas/public/tables/table-example/rows',
    '/v1/postgres/workspaces//data/database-example/schemas/public/tables/table-example/rows',
  ];
  for (const [method, uri] of [...paths, ...unsupportedPaths.map((uri) => ['POST', uri])]) {
    const selected = selectRoute(method, uri, { authorization: 'Bearer test-token' });
    assert.equal(selected?.id, '2005', `${method} ${uri}`);
    assert.match(selected.block, /falcone-control-plane\.falcone\.svc\.cluster\.local:8080/);
  }
  assert.equal(priority(route('2005')), 235);
});

test('Postgres bearer plugins exactly mirror Mongo verification and gateway hardening', () => {
  const plugins = (block) => block.split('    plugins:\n')[1].split('    upstream:\n')[0]
    .replace(/^\s*#.*\n/gm, '');
  const bearer = route('2005-data');
  assert.equal(plugins(bearer), plugins(route('2006')));
  assert.doesNotMatch(bearer, /openid-connect:|issuers:/);
  assert.deepEqual([...plugins(bearer).matchAll(/^      ([\w-]+):/gm)].map((match) => match[1]),
    ['cors', 'issuer-jwks-auth', 'limit-count', 'client-control', 'request-validation', 'proxy-rewrite']);
  assert.match(bearer, /issuer_base_url: "http:\/\/falcone-keycloak:8080"/);
  assert.match(bearer, /jwks_base_url: "http:\/\/falcone-keycloak:8080"/);
  assert.match(bearer, /enforce_tenant_audience: true/);
  assert.match(bearer, /rejected_code: 429/);
  assert.match(bearer, /max_body_size: 1048576/);
  assert.match(bearer, /required: \["X-API-Version", "X-Correlation-Id"\]/);
  const remove = bearer.split('          remove:\n')[1].split('\n    upstream:')[0];
  for (const header of ['X-Tenant-Id', 'X-Workspace-Id', 'X-Auth-Subject', 'X-Actor-Roles']) {
    assert.ok(bearer.includes(`${header}: { type: string, maxLength: 0 }`), `${header} must be rejected`);
    assert.match(remove, new RegExp(`^            - ${header.toLowerCase()}$`, 'm'), `${header} must be stripped`);
  }
  for (const header of ['apikey', 'x-api-key']) {
    assert.match(remove, new RegExp(`^            - ${header}$`, 'm'));
    assert.equal(selectRoute('GET', `${tablePath}/rows`, { [header]: 'noncanonical-test-key' })?.id, '2005-data');
  }
  assert.equal(selectRoute('GET', `${tablePath}/rows`, { 'x-api-key': 'flc_test_only' })?.id, '2005-data');
  assert.match(bearer, /X-Correlation-Id: \$http_x_correlation_id/);
  assert.match(bearer, /X-Request-Id: \$request_id/);
  assert.match(bearer, /x-gateway-auth: "\$\{\{GATEWAY_SHARED_SECRET\}\}"/);
});

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const chartPath = process.env.FALCONE_CHART_PATH ?? resolve(repoRoot, '../falcone-charts/charts/in-falcone');

test('kind and chart standalone Postgres route tables are byte-identical',
  { skip: !existsSync(chartPath) ? `chart unavailable at ${chartPath}; set FALCONE_CHART_PATH` : false }, () => {
    const standalone = readFileSync(resolve(chartPath, 'files/apisix/standalone/apisix.yaml'));
    assert.ok(Buffer.from(routeTable).equals(standalone), 'kind and chart standalone routes must be byte-identical');
  });
