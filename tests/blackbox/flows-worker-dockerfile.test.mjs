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
import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKER_DIR = resolve(REPO_ROOT, 'apps', 'workflow-worker');
const workerDeps = readFileSync(resolve(WORKER_DIR, 'src', 'worker-deps.mjs'), 'utf8');
const dockerfile = readFileSync(resolve(WORKER_DIR, 'Dockerfile'), 'utf8');

// worker-deps.mjs is copied verbatim into dist/ by scripts/copy-activity-catalog.mjs, so at
// runtime it lives at /app/apps/workflow-worker/dist/worker-deps.mjs. Its relative
// dynamicImport() specifiers therefore resolve against the dist dir, i.e. repo root maps to
// /app and `../../../<x>` from dist == `<x>` from the repo root.
const DIST_REL = ['apps', 'workflow-worker', 'dist']; // worker-deps.mjs's dir, repo-relative

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
// Join continued lines, then inspect only COPY sources (not comments or RUN guards).
// Both apps/* and packages/* modules must land at /app/<repo path> to resolve from
// the shipped dist/ directory. Merely appearing as a source is not sufficient.
function filesUnder(source) {
  if (!existsSync(resolve(REPO_ROOT, source))) return [];
  if (!statSync(resolve(REPO_ROOT, source)).isDirectory()) return [source];
  return readdirSync(resolve(REPO_ROOT, source)).flatMap(name => filesUnder(posix.join(source, name)));
}

function modulesCopiedBy(text) {
  return new Set([...text.replace(/\\\s*\r?\n/g, ' ').matchAll(/^\s*COPY\s+([^\r\n]+)/gim)].flatMap(match => {
    const tokens = match[1].trim().split(/\s+/);
    const destination = tokens.at(-1);
    const sources = tokens.slice(0, -1);
    return sources.filter(source => /^(?:apps|packages)\//.test(source)).flatMap(source => {
      const directory = existsSync(resolve(REPO_ROOT, source)) && statSync(resolve(REPO_ROOT, source)).isDirectory();
      return filesUnder(source).filter(file => {
        const imagePath = directory ? posix.join(destination, file.slice(source.replace(/\/$/, '').length + 1))
          : sources.length > 1 || destination.endsWith('/') ? posix.join(destination, posix.basename(file)) : posix.normalize(destination);
        return imagePath === posix.join('/app', file);
      });
    });
  }));
}
const copiedModules = modulesCopiedBy(dockerfile);

// Follow static relative imports/re-exports from every dynamically imported entry point.
function transitiveModules() {
  const pending = importedSpecs.map(specToRepoPath);
  const visited = new Set();
  while (pending.length) {
    const path = pending.pop();
    if (visited.has(path)) continue;
    visited.add(path);
    const source = readFileSync(resolve(REPO_ROOT, path), 'utf8');
    for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"](\.[^'"]+)['"]/g)) {
      pending.push(posix.normalize(posix.join(posix.dirname(path), match[1])));
    }
  }
  return [...visited];
}

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


test('bbx-flows-worker-dockerfile-05: transitive imports are shipped at the same relative paths', () => {
  assert.deepEqual(transitiveModules().filter(path => !copiedModules.has(path)), []);
  const withoutAdapters = dockerfile.replace(/^COPY apps\/control-plane-executor\/src\/runtime\/llm-adapters\/[^\n]*\n/m, '');
  assert.ok(transitiveModules().some(path => !modulesCopiedBy(withoutAdapters).has(path)), 'removing the adapter directory COPY must be detected');
});

test('bbx-flows-worker-dockerfile-06: actual image guard rejects a missing transitive module', () => {
  const guard = dockerfile.match(/^RUN node --input-type=module -e "(.*)"$/m)?.[1];
  assert.ok(guard, 'build-time guard must be executable offline');
  const root = mkdtempSync(resolve(tmpdir(), 'falcone-worker-image-'));
  try {
    const distDir = resolve(root, ...DIST_REL);
    mkdirSync(distDir, { recursive: true });
    copyFileSync(resolve(WORKER_DIR, 'src/worker-deps.mjs'), resolve(distDir, 'worker-deps.mjs'));
    for (const path of copiedModules) {
      const destination = resolve(root, path);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(resolve(REPO_ROOT, path), destination);
    }
    const program = guard.replace("'/app/apps/workflow-worker/dist'", JSON.stringify(distDir));
    const run = () => spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8' });
    const complete = run();
    assert.equal(complete.status, 0, complete.stderr);
    rmSync(resolve(root, 'apps/control-plane-executor/src/runtime/llm-adapters/contract.mjs'));
    const incomplete = run();
    assert.equal(incomplete.status, 1, incomplete.stderr);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
