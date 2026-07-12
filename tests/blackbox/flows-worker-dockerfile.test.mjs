/**
 * Black-box tests for fix-660-worker-image-module-completeness (P1, cap:workflows +
 * deployment; verifier-reproduced 2026-06-21 BUG-WORKER-IMAGE-MODULE-COMPLETENESS / #660).
 *
 * Defect: apps/workflow-worker/src/worker-deps.mjs::wireActivityDeps() dynamic-imports
 * a set of apps/control-plane-executor runtime modules + packages/internal-contracts at boot, but
 * apps/workflow-worker/Dockerfile only COPYs a by-name allow-list of those modules.
 * That allow-list drifted from worker-deps.mjs (the llm.complete activity #640, the BYOK
 * confinement #659, and the transport-security helper #645 each added an import that was
 * never COPYed), so a worker image built from origin/main crash-loops at boot with
 * ERR_MODULE_NOT_FOUND, taking down ALL Temporal Flow execution.
 *
 * Fix: extend the Dockerfile COPY allow-list to cover every module worker-deps.mjs imports,
 * and add a build-time guard that fails the build when a dynamic-imported module is not
 * copied (so future drift is a build error, not a runtime crash-loop).
 *
 * Hermetic: parses worker-deps.mjs + the Dockerfile + the repo tree (no running stack, no
 * docker build), mirroring tests/blackbox/scheduling-handler-dockerfile.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKER_DIR = resolve(REPO_ROOT, 'services', 'workflow-worker');
const workerDeps = readFileSync(resolve(WORKER_DIR, 'src', 'worker-deps.mjs'), 'utf8');
const dockerfile = readFileSync(resolve(WORKER_DIR, 'Dockerfile'), 'utf8');

// worker-deps.mjs is copied verbatim into dist/ by scripts/copy-activity-catalog.mjs, so at
// runtime it lives at /app/apps/workflow-worker/dist/worker-deps.mjs. Its relative
// dynamicImport() specifiers therefore resolve against the dist dir, i.e. repo root maps to
// /app and `../../../<x>` from dist == `<x>` from the repo root.
const DIST_REL = ['services', 'workflow-worker', 'dist']; // worker-deps.mjs's dir, repo-relative

// Relative `.mjs` specifiers worker-deps.mjs dynamic-imports (excludes bare npm specifiers
// such as 'pg', which resolve from node_modules and are not COPYed file-by-file).
const importedSpecs = [...workerDeps.matchAll(/dynamicImport\(\s*['"]([^'"]+)['"]/g)]
  .map((m) => m[1])
  .filter((s) => s.startsWith('.') && s.endsWith('.mjs'));

// Resolve an import spec (relative to dist/) to a repo-relative module path.
function specToRepoPath(spec) {
  return resolve(resolve(REPO_ROOT, ...DIST_REL), spec).slice(REPO_ROOT.length + 1);
}

// Repo-relative module paths the Dockerfile COPYs into the runtime image. The worker
// Dockerfile COPYs control-plane runtime modules and internal-contracts modules by listing
// the source path(s) on their own continued lines, e.g.:
//   COPY apps/control-plane-executor/src/runtime/llm-executor.mjs \
//        apps/control-plane-executor/src/runtime/byok-provider-guard.mjs \
//        /app/apps/control-plane-executor/src/runtime/
// We collect every `<repo path>.mjs` token that appears as a COPY source in the file.
const copiedModules = new Set(
  [...dockerfile.matchAll(/(?:^|\s)((?:apps|services)\/[^\s\\]+\.mjs)\b/g)].map((m) => m[1]),
);

test('bbx-flows-worker-dockerfile-01: every module worker-deps.mjs dynamic-imports is COPYed into the image (no drift)', () => {
  assert.ok(importedSpecs.length > 0, 'worker-deps.mjs should dynamic-import at least one relative .mjs module');
  const missing = importedSpecs
    .map((spec) => ({ spec, path: specToRepoPath(spec) }))
    .filter(({ path }) => !copiedModules.has(path));
  assert.deepEqual(
    missing.map((m) => m.path),
    [],
    `Dockerfile is missing a COPY for module(s) worker-deps.mjs imports: ${missing.map((m) => `${m.path} (from ${m.spec})`).join(', ')}`,
  );
});

test('bbx-flows-worker-dockerfile-02: llm-executor, byok-provider-guard and transport-security are COPYed (the named regression)', () => {
  const required = [
    'apps/control-plane-executor/src/runtime/llm-executor.mjs',
    'apps/control-plane-executor/src/runtime/byok-provider-guard.mjs',
    'packages/internal-contracts/src/transport-security.mjs',
  ];
  for (const mod of required) {
    // It must actually be imported by worker-deps.mjs ...
    assert.ok(
      importedSpecs.some((spec) => specToRepoPath(spec) === mod),
      `worker-deps.mjs should dynamic-import ${mod}`,
    );
    // ... and COPYed by the Dockerfile.
    assert.ok(copiedModules.has(mod), `Dockerfile must COPY ${mod} into the runtime image`);
  }
});

test('bbx-flows-worker-dockerfile-03: every module worker-deps.mjs imports exists in the repo', () => {
  for (const spec of importedSpecs) {
    const path = specToRepoPath(spec);
    assert.ok(existsSync(resolve(REPO_ROOT, path)), `${path} (imported as ${spec}) must exist`);
  }
});

test('bbx-flows-worker-dockerfile-04: the Dockerfile fails the build when a dynamic-imported module is missing', () => {
  // A build-time guard (node over the shipped dist/worker-deps.mjs) turns a missing COPY
  // into a build failure instead of a runtime ERR_MODULE_NOT_FOUND crash-loop.
  assert.match(
    dockerfile,
    /RUN node[\s\S]*worker-deps\.mjs[\s\S]*process\.exit\(1\)/,
    'a build-time worker-deps module-resolution guard must be present',
  );
});
