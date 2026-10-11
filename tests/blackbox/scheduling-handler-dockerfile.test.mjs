/**
 * Black-box tests for fix-scheduling-handler-dockerfile (P1, live E2E re-run 2026-06-18
 * BUG-SCHEDULING-DOCKERFILE).
 *
 * Defect: the route map dispatched `/v1/scheduling/*` to
 * `/repo/packages/scheduling-engine/actions/scheduling-management.mjs`, but the kind
 * control-plane Dockerfile only COPYed packages/provisioning-orchestrator (+ internal-
 * contracts + apps/control-plane-executor). At runtime the dynamic import failed →
 * ERR_MODULE_NOT_FOUND → 500 on every scheduling request.
 *
 * Fix: COPY packages/scheduling-engine into the image, and add a build-time check that
 * every route-map handler module resolves so a missing COPY fails the build (not a 500).
 *
 * Hermetic: parses the route map + Dockerfile + repo tree (no running stack), mirroring
 * the chart/deploy-completeness suites.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CP_DIR = resolve(REPO_ROOT, 'apps', 'control-plane');
const routeMap = JSON.parse(readFileSync(resolve(CP_DIR, 'route-map.runtime.json'), 'utf8'));
const dockerfile = readFileSync(resolve(CP_DIR, 'Dockerfile'), 'utf8');

// Distinct repository trees the route map dispatches to (/repo/{packages,apps}/<tree>).
const referencedTrees = [...new Set(
  routeMap
    .filter((r) => typeof r.module === 'string')
    .map((r) => /^\/repo\/((?:packages|apps)\/[^/]+)/.exec(r.module)?.[1])
    .filter(Boolean),
)];
// Join continued COPY lines and preserve the packages/apps prefix so distinct trees
// cannot be mistaken for one another. The destination must match the route-map path.
const logicalDockerfile = dockerfile.replace(/\\\s*\r?\n/g, ' ');
const copiedTrees = [...logicalDockerfile.matchAll(/^\s*COPY\s+((?:packages|apps)\/[^/\s]+)\s+\/repo\/\1\/?\s*$/gim)].map((m) => m[1]);
const copiedControlPlaneModules = new Set(
  [...logicalDockerfile.matchAll(/^\s*COPY\s+([^\r\n]+)/gim)]
    .map((m) => m[1].trim().split(/\s+/))
    // WORKDIR is /app; only modules copied there satisfy the flattened local imports.
    .filter((tokens) => ['.', './', '/app', '/app/'].includes(tokens.at(-1)))
    .flatMap((tokens) => tokens.slice(0, -1))
    .map((source) => /^apps\/control-plane\/([A-Za-z0-9_.-]+\.mjs)$/.exec(source)?.[1])
    .filter(Boolean),
);

function localImports(moduleName) {
  const source = readFileSync(resolve(CP_DIR, moduleName), 'utf8');
  const staticImports = [...source.matchAll(/(?:^|\n)\s*import\s+(?:[^'"]+\s+from\s+)?['"]\.\/([^'"]+\.mjs)['"]/g)].map((m) => m[1]);
  const dynamicImports = [...source.matchAll(/import\(\s*['"]\.\/([^'"]+\.mjs)['"]\s*\)/g)].map((m) => m[1]);
  return [...new Set([...staticImports, ...dynamicImports])];
}

test('bbx-sched-dockerfile-01: every route-map packages/apps tree is COPYed by the Dockerfile', () => {
  assert.ok(referencedTrees.length > 0, 'route map should reference at least one packages/apps tree');
  const missing = referencedTrees.filter((t) => !copiedTrees.includes(t));
  assert.deepEqual(missing, [], `Dockerfile is missing COPY for: ${missing.join(', ')}`);
});

test('bbx-sched-dockerfile-02: scheduling-engine specifically is COPYed (the regression)', () => {
  assert.ok(referencedTrees.includes('packages/scheduling-engine'), 'route map should dispatch to packages/scheduling-engine');
  assert.ok(copiedTrees.includes('packages/scheduling-engine'), 'Dockerfile must COPY packages/scheduling-engine to /repo/packages/scheduling-engine');
});

test('bbx-sched-dockerfile-03: the scheduling handler module exists in the repo', () => {
  const sched = routeMap.find((r) => typeof r.module === 'string' && r.module.includes('scheduling-engine'));
  assert.ok(sched, 'route map should have a scheduling-engine handler');
  const relPath = sched.module.replace(/^\/repo\//, '');
  assert.ok(existsSync(resolve(REPO_ROOT, relPath)), `${relPath} must exist`);
});

test('bbx-sched-dockerfile-04: the Dockerfile fails the build when a route handler is missing', () => {
  // A build-time guard (node -e over route-map.runtime.json) turns a missing COPY into a
  // build failure instead of a runtime 500.
  assert.match(dockerfile, /RUN node -e[\s\S]*route-map\.runtime\.json[\s\S]*process\.exit\(1\)/, 'a build-time route-module resolution check must be present');
});

test('bbx-sched-dockerfile-05: every copied local control-plane module import is also COPYed', () => {
  assert.ok(copiedControlPlaneModules.has('server.mjs'), 'Dockerfile must COPY server.mjs to /app');
  const missing = [];
  for (const moduleName of copiedControlPlaneModules) {
    for (const imported of localImports(moduleName)) {
      if (!copiedControlPlaneModules.has(imported)) missing.push(`${moduleName} -> ${imported}`);
    }
  }

  assert.deepEqual(missing, [], `Dockerfile is missing local control-plane module COPY entries: ${missing.join(', ')}`);
});

test('bbx-sched-dockerfile-06: realtime handlers are COPYed with b-handlers dependencies', () => {
  assert.ok(copiedControlPlaneModules.has('b-handlers.mjs'), 'Dockerfile must COPY b-handlers.mjs');
  assert.ok(copiedControlPlaneModules.has('realtime-handlers.mjs'), 'Dockerfile must COPY realtime-handlers.mjs');
});
