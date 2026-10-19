import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { routes } from '../../apps/control-plane/routes.mjs';
import { loadRoutes, matchRoute } from '../../apps/control-plane/route-table.mjs';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const developer = read('docs-site/guide/developer-end-to-end.md');
const runtime = read('apps/control-plane/route-map.runtime.json');
const openapi = read('apps/control-plane-executor/openapi/control-plane.openapi.json');

// Only the two handlers used by this walkthrough that the executor OpenAPI omits.
// Each citation is checked against the exact declaration at the current source line.
const executorSource = 'apps/control-plane-executor/src/runtime/server.mjs';
const exceptions = [
  {
    method: 'POST', path: '/v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions',
    source: executorSource, line: 803,
    declaration: "['POST', new RegExp(`${fl}/([^/]+)/executions$`), `${templates.fl}/{flowId}/executions`, ([w, f], c) =>",
  },
  {
    method: 'DELETE', path: '/v1/flows/workspaces/{workspaceId}/flows/{flowId}',
    source: executorSource, line: 791,
    declaration: "['DELETE', new RegExp(`${fl}/([^/]+)$`), `${templates.fl}/{flowId}`, ([w, f], c) =>",
  },
];

function templateMatches(template, path) {
  const expected = template.split('/');
  const actual = path.split('/');
  return expected.length === actual.length && expected.every((segment, index) =>
    /^\{\w+\}$/.test(segment) ? actual[index].length > 0 : segment === actual[index]);
}

function apiRequests(markdown) {
  return codeBlocks(markdown).flatMap(block => block.replace(/\\\r?\n/g, ' ').split('\n').flatMap(line => {
    if (!/\bcurl\s/.test(line)) return [];
    const url = line.match(/\$(?:API\b|\{API\})(\/v1\/[^\s"']+)/);
    if (!url) return [];
    const method = line.match(/(?:^|\s)(?:-[a-zA-Z]*X\s*|--request(?:=|\s+))([A-Z]+)/)?.[1] ?? 'GET';
    const path = url[1].split('?')[0].replace(/\$(?:\{\w+\}|\w+)/g, 'doc-value');
    return [{ method, path }];
  }));
}

function requestViolations(markdown, runtimeJson, openapiJson) {
  // Same effective route loading and server matcher as route-catalog-reconciliation.test.mjs.
  const table = loadRoutes(JSON.parse(runtimeJson), routes);
  const paths = JSON.parse(openapiJson).paths;
  return apiRequests(mainPath(markdown)).filter(({ method, path }) =>
    !matchRoute(table, method, path) &&
    !Object.entries(paths).some(([template, operations]) => operations[method.toLowerCase()] && templateMatches(template, path)) &&
    !exceptions.some(entry => entry.method === method && templateMatches(entry.path, path))
  ).map(({ method, path }) => `No handler: ${method} ${path}`);
}

function citationViolations(server, openapiJson) {
  const paths = JSON.parse(openapiJson).paths;
  const lines = server.split('\n');
  return exceptions.flatMap(entry => {
    const citation = `${entry.source}:${entry.line}`;
    const errors = [];
    if (paths[entry.path]?.[entry.method.toLowerCase()]) errors.push(`${citation}: exception is now declared in OpenAPI`);
    if (lines[entry.line - 1]?.trim() !== entry.declaration) errors.push(`${citation}: handler declaration drifted`);
    return errors;
  });
}

function examplesViolations(examplesExist, files) {
  const errors = examplesExist ? ['docs-site/guide/examples.md must be unpublished'] : [];
  for (const [path, contents] of Object.entries(files)) {
    if (/\/guide\/examples\b|\bexamples\.md\b/.test(contents)) errors.push(`${path} links to unpublished examples`);
  }
  return errors;
}

function docsSourceFiles(directory = 'docs-site') {
  return readdirSync(new URL(`../../${directory}/`, import.meta.url), { withFileTypes: true }).flatMap(entry => {
    // Generated build outputs and installed dependencies are not documentation sources.
    if (['node_modules', 'cache', 'dist'].includes(entry.name)) return [];
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? docsSourceFiles(path) : [[path, read(path)]];
  });
}

function mainPath(markdown) {
  return markdown.split(/^## Local cluster \(operator\)\s*$/m)[0];
}

function transportViolations(markdown) {
  const main = mainPath(markdown);
  const errors = [];
  for (const forbidden of ['kubectl', 'port-forward', '127.0.0.1']) {
    if (main.includes(forbidden)) errors.push(`Main path contains ${forbidden}`);
  }
  for (const variable of ['API', 'IAM']) {
    if (!new RegExp(`^export ${variable}=["']https://<[^>]+>["']$`, 'm').test(main)) {
      errors.push(`${variable} must use an HTTPS hostname placeholder`);
    }
  }
  return errors;
}

function codeBlocks(markdown) {
  return [...markdown.matchAll(/^```[^\n]*\n([\s\S]*?)^```\s*$/gm)].map(match => match[1]);
}

// Explicit non-shell exclusions: jq --arg bindings used inside single-quoted jq programs.
// No shell-internal or loop variables are currently needed by these examples.
const nonShellVariables = new Set(['tenant', 'workspace', 'action']);

function variableViolations(markdown) {
  const assigned = new Set();
  const errors = [];
  for (const [index, block] of codeBlocks(markdown).entries()) {
    for (const match of block.matchAll(/\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/g)) {
      const variable = match[1] ?? match[2];
      const jqBinding = nonShellVariables.has(variable) && block.includes(`--arg ${variable} `);
      if (!assigned.has(variable) && !jqBinding) {
        errors.push(`Block ${index + 1}: $${variable} needs an assignment in an earlier block`);
      }
    }
    for (const match of block.matchAll(/^(?:export )?([A-Za-z_]\w*)=/gm)) assigned.add(match[1]);
  }
  return errors;
}

test('developer main path uses operator-provided public hostnames', () => {
  assert.deepEqual(transportViolations(developer), []);
});

test('transport checker rejects a seeded port-forward without writing docs', () => {
  const fixture = 'export API="https://<console hostname>"\nexport IAM="https://<identity hostname>"\n';
  assert.deepEqual(transportViolations(fixture), []);
  assert.ok(transportViolations(`${fixture}kubectl port-forward svc/example 8080:8080`).includes('Main path contains kubectl'));
  assert.deepEqual(transportViolations(`${fixture}\n## Local cluster (operator)\nkubectl port-forward svc/example 8080:8080`), []);
});

test('developer shell variables have sources in earlier blocks on the same page', () => {
  assert.deepEqual(variableViolations(mainPath(developer)), []);
});

test('Flows shell variables have sources in earlier blocks on the same page', () => {
  assert.deepEqual(variableViolations(read('docs-site/guide/flows.md')), []);
});

test('MCP shell variables have sources in earlier blocks on the same page', () => {
  assert.deepEqual(variableViolations(read('docs-site/guide/mcp.md')), []);
});

test('variable checker rejects unassigned variables, including braced and same-block uses', () => {
  const fixture = '```bash\nexport API="https://<console hostname>"\n```\n\n```bash\ncurl "$API/v1/workspaces/x"\n```';
  assert.deepEqual(variableViolations(fixture), []);
  for (const use of ['$UNASSIGNED', '${UNASSIGNED}', 'UNASSIGNED=x\necho $UNASSIGNED']) {
    assert.ok(variableViolations(`${fixture}\n\n\x60\x60\x60bash\n${use}\n\x60\x60\x60`).some(error => error.includes('$UNASSIGNED')));
  }
});

test('each public API curl in the developer main path resolves to a handler', () => {
  assert.ok(apiRequests(mainPath(developer)).length > 0, 'walkthrough must include API requests');
  assert.deepEqual(requestViolations(developer, runtime, openapi), []);
  for (const entry of exceptions) {
    assert.ok(apiRequests(mainPath(developer)).some(request =>
      request.method === entry.method && templateMatches(entry.path, request.path)), 'allow-list must remain minimal');
  }
});

test('request checker rejects removed collection routes and wrong methods on GET-only routes', () => {
  const fixture = command => `\x60\x60\x60bash\n${command}\n\x60\x60\x60`;
  assert.deepEqual(requestViolations(fixture('curl "$API/v1/platform/runtime/knative"'), runtime, openapi), []);
  assert.deepEqual(requestViolations(fixture('curl "$API/v1/collections/x/documents"'), runtime, openapi),
    ['No handler: GET /v1/collections/x/documents']);
  assert.deepEqual(requestViolations(fixture('curl -X PUT "$API/v1/platform/runtime/knative"'), runtime, openapi),
    ['No handler: PUT /v1/platform/runtime/knative']);
  assert.deepEqual(apiRequests(fixture('curl -sX POST "${API}/v1/flows/workspaces/${WS}/flows/$FLOW/executions"')),
    [{ method: 'POST', path: '/v1/flows/workspaces/doc-value/flows/doc-value/executions' }]);
  assert.equal(templateMatches('/v1/flows/{flowId}', '/v1/flows/a/b'), false);
  assert.equal(templateMatches('/v1/flows/{flowId}', '/v1/flows/'), false);
});

test('allow-list citations point to current executor regexes and operations absent from OpenAPI', () => {
  const server = read(executorSource);
  assert.deepEqual(citationViolations(server, openapi), []);
  assert.ok(server.includes("const fl = '^/v1/flows/workspaces/([^/]+)/flows';"));
  assert.ok(server.includes("fl: '/v1/flows/workspaces/{workspaceId}/flows',"));
  assert.ok(citationViolations(`\n${server}`, openapi).length > 0, 'line drift must fail');
  const updatedOpenapi = JSON.parse(openapi);
  updatedOpenapi.paths[exceptions[0].path].post = {};
  assert.ok(citationViolations(server, JSON.stringify(updatedOpenapi)).some(error => error.includes('now declared')));
});

test('obsolete examples page is absent and no docs source links to it', () => {
  assert.deepEqual(examplesViolations(
    existsSync(new URL('../../docs-site/guide/examples.md', import.meta.url)),
    Object.fromEntries(docsSourceFiles()),
  ), []);
});

test('examples checker catches stale links anywhere in docs sources', () => {
  assert.deepEqual(examplesViolations(false, { 'guide/page.md': '[Developer](/guide/developer-end-to-end)' }), []);
  assert.ok(examplesViolations(true, {}).length > 0);
  for (const link of ['/guide/examples', './examples.md', '/guide/examples#data']) {
    assert.ok(examplesViolations(false, { 'nested/page.md': link }).length > 0);
  }
});
