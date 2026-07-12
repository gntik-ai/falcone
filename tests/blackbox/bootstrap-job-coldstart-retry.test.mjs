/**
 * Black-box regression suite for spec change fix-bootstrap-job-coldstart-retry
 * (live E2E campaign 2026-06-18, finding #558, epic #542).
 *
 * Drives the PUBLIC chart surface ONLY via `helm template` as a child process; no internal
 * knowledge of the Go templates is used. Renders the bootstrap Job and the values defaults and
 * asserts the Job is robust to the cold-start race.
 *
 * Defect: on a COLD fresh `helm install` the bootstrap Job ran its create-only phase against a
 * Keycloak that was not yet Ready. With `backoffLimit: 1` (a single retry) and only the curl
 * --retry budget inside the script (~30s), the Job exhausted its retries before Keycloak
 * accepted the admin token, so it reported BackoffLimitExceeded and the platform realm / roles /
 * clients / superadmin were never provisioned. The bootstrap LOGIC is correct — re-running the
 * same pod a minute later provisions everything and exits 0 — it was just not robust to the race.
 *
 * Fix: gate the bootstrap container behind a Keycloak-readiness wait initContainer (polls the
 * Keycloak service until the master realm answers 200) AND raise the Job backoffLimit so a cold
 * install converges WITHOUT a manual re-run. Both are chart-driven via the new
 * `bootstrap.job.keycloakReadiness` stanza and the raised `bootstrap.job.backoffLimit`.
 *
 * Self-skips when `helm` is absent (repo precedent: pgvector/temporal-helm).
 *
 * Scenario coverage (capability: tenant-provisioning / spec.md):
 *   bbx-558-01  Job declares a Keycloak-readiness wait initContainer
 *   bbx-558-02  the wait initContainer polls the Keycloak service (master realm) until it answers
 *   bbx-558-03  the Job backoffLimit default is raised above the cold-start floor (>1)
 *   bbx-558-04  the readiness wait can be disabled (keycloakReadiness.enabled=false) — opt-out
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CHART_PATH = resolve(REPO_ROOT, 'charts', 'in-falcone');
const TEMPLATE = 'templates/bootstrap-job.yaml';

function helmAvailable() {
  return spawnSync('helm', ['version', '--short'], { encoding: 'utf8' }).status === 0;
}
const SKIP = helmAvailable() ? false : { skip: 'helm binary not available on PATH' };

function renderJob(extraArgs = []) {
  const r = spawnSync(
    'helm',
    ['template', 'falcone', CHART_PATH, '-s', TEMPLATE, ...extraArgs],
    { encoding: 'utf8', cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 },
  );
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  return r.stdout;
}

/** Extract the `initContainers:` block of the Job spec (everything up to the sibling `containers:`). */
function initContainersBlock(job) {
  const m = job.match(/\n(\s*)initContainers:\n([\s\S]*?)\n\1containers:/);
  return m ? m[2] : '';
}

// -------------------------------------------------------------------------
// bbx-558-01: the Job declares a Keycloak-readiness wait initContainer
// -------------------------------------------------------------------------
test('bbx-558-01: bootstrap Job has a Keycloak-readiness wait initContainer', SKIP, () => {
  const job = renderJob();
  assert.match(job, /\n\s*initContainers:/, 'Job spec must declare initContainers');
  const block = initContainersBlock(job);
  assert.ok(block.length > 0, 'initContainers block must be non-empty');
  assert.match(block, /-\s*name:\s*wait-for-keycloak/, 'must include a wait-for-keycloak initContainer');
});

// -------------------------------------------------------------------------
// bbx-558-02: the wait initContainer polls the Keycloak service master realm
// -------------------------------------------------------------------------
test('bbx-558-02: wait initContainer polls the Keycloak service until the master realm answers', SKIP, () => {
  const block = initContainersBlock(renderJob());
  assert.match(block, /falcone-keycloak[^\n]*8080/, 'must target the Keycloak service on its http port');
  assert.match(block, /realms\/master/, 'must poll the Keycloak master realm endpoint');
  // a bounded poll loop (until/while) so the wait is robust to a slow cold start
  assert.match(block, /\b(until|while)\b/, 'must loop until Keycloak is reachable');
});

// -------------------------------------------------------------------------
// bbx-558-03: the default backoffLimit is raised above the cold-start floor
// -------------------------------------------------------------------------
test('bbx-558-03: default backoffLimit is raised above 1 (cold-start retry budget)', SKIP, () => {
  const job = renderJob();
  const m = job.match(/\n\s*backoffLimit:\s*(\d+)/);
  assert.ok(m, 'Job must declare a numeric backoffLimit');
  assert.ok(Number(m[1]) > 1, `backoffLimit must exceed 1 for a cold install; got ${m && m[1]}`);
});

// -------------------------------------------------------------------------
// bbx-558-04: the readiness wait is opt-out via keycloakReadiness.enabled=false
// -------------------------------------------------------------------------
test('bbx-558-04: keycloakReadiness.enabled=false removes the wait initContainer', SKIP, () => {
  const job = renderJob(['--set', 'bootstrap.job.keycloakReadiness.enabled=false']);
  const block = initContainersBlock(job);
  assert.ok(
    !/-\s*name:\s*wait-for-keycloak/.test(block),
    'wait-for-keycloak initContainer must be absent when keycloakReadiness.enabled=false',
  );
});
