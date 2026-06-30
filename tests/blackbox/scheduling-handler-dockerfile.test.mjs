/**
 * Black-box tests for fix-scheduling-handler-dockerfile (P1, live E2E re-run 2026-06-18
 * BUG-SCHEDULING-DOCKERFILE).
 *
 * Defect: the route map dispatched `/v1/scheduling/*` to
 * `/repo/services/scheduling-engine/actions/scheduling-management.mjs`, but the kind
 * control-plane Dockerfile only COPYed services/provisioning-orchestrator (+ internal-
 * contracts + apps/control-plane). At runtime the dynamic import failed →
 * ERR_MODULE_NOT_FOUND → 500 on every scheduling request.
 *
 * Fix: COPY services/scheduling-engine into the image, and add a build-time check that
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
const CP_DIR = resolve(REPO_ROOT, 'deploy', 'kind', 'control-plane');
const routeMap = JSON.parse(readFileSync(resolve(CP_DIR, 'route-map.runtime.json'), 'utf8'));
const dockerfile = readFileSync(resolve(CP_DIR, 'Dockerfile'), 'utf8');

// Distinct services trees the route map dispatches to (/repo/services/<tree>).
const referencedTrees = [...new Set(
  routeMap
    .filter((r) => typeof r.module === 'string')
    .map((r) => /^\/repo\/services\/([^/]+)/.exec(r.module)?.[1])
    .filter(Boolean),
)];
// Trees the Dockerfile COPYs into /repo/services/.
const copiedTrees = [...dockerfile.matchAll(/COPY\s+services\/([^/\s]+)\s+\/repo\/services\//g)].map((m) => m[1]);
const copiedControlPlaneModules = new Set(
  [...dockerfile.matchAll(/deploy\/kind\/control-plane\/([A-Za-z0-9_.-]+\.mjs)\b/g)].map((m) => m[1]),
);

function localImports(moduleName) {
  const source = readFileSync(resolve(CP_DIR, moduleName), 'utf8');
  const staticImports = [...source.matchAll(/(?:^|\n)\s*import\s+(?:[^'"]+\s+from\s+)?['"]\.\/([^'"]+\.mjs)['"]/g)].map((m) => m[1]);
  const dynamicImports = [...source.matchAll(/import\(\s*['"]\.\/([^'"]+\.mjs)['"]\s*\)/g)].map((m) => m[1]);
  return [...new Set([...staticImports, ...dynamicImports])];
}

test('bbx-sched-dockerfile-01: every route-map services tree is COPYed by the Dockerfile', () => {
  const missing = referencedTrees.filter((t) => !copiedTrees.includes(t));
  assert.deepEqual(missing, [], `Dockerfile is missing COPY for: ${missing.join(', ')}`);
});

test('bbx-sched-dockerfile-02: scheduling-engine specifically is COPYed (the regression)', () => {
  assert.ok(referencedTrees.includes('scheduling-engine'), 'route map should dispatch to scheduling-engine');
  assert.ok(copiedTrees.includes('scheduling-engine'), 'Dockerfile must COPY services/scheduling-engine');
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
