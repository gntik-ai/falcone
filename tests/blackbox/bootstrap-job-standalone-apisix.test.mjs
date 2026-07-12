/**
 * Black-box regression suite for spec change fix-bootstrap-job-standalone-apisix
 * (live E2E campaign 2026-06-17, finding D2).
 *
 * Drives the PUBLIC chart surface ONLY via `helm template` as a child process, extracts the
 * rendered bootstrap.sh from the ConfigMap, and asserts its shape (plus a `bash -n` syntax gate).
 *
 * Defect: the bootstrap Job's upgrade-reconciliation phase PUTs routes to the APISIX admin API
 * and `ensure_apisix_route` does `exit 1` on failure. APISIX runs in standalone mode by default
 * (APISIX_STAND_ALONE=true), where the admin API is not served — so the reconcile always failed
 * and aborted the Job, leaving the platform realm / clients / superadmin effectively unusable.
 * Verified live: the apisix admin Service refuses connections on :9180 under standalone.
 *
 * Fix: skip the admin-API reconciliation entirely in standalone mode (zero admin-API calls), and
 * add a fail-closed verify_auth_layer smoke step so the Job never reports success with the auth
 * layer missing.
 *
 * Self-skips when `helm` is absent (repo precedent: pgvector/temporal-helm).
 *
 * Scenario coverage (capability: tenant-provisioning / spec.md):
 *   bbx-d2-01  standalone (default) → zero ensure_apisix_route call-sites; skip log present; bash -n OK
 *   bbx-d2-02  non-standalone       → ensure_apisix_route call-sites present; bash -n OK
 *   bbx-d2-03  verify_auth_layer defined AND invoked in main before write_marker
 *   bbx-d2-04  verify_auth_layer is fail-closed and checks realm + clients + superadmin
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CHART_PATH = resolve(REPO_ROOT, '..', 'falcone-charts', 'charts', 'in-falcone');
const TEMPLATE = 'templates/bootstrap-script-configmap.yaml';

function helmAvailable() {
  return spawnSync('helm', ['version', '--short'], { encoding: 'utf8' }).status === 0;
}
const SKIP = helmAvailable() ? false : { skip: 'helm binary not available on PATH' };

function renderScript(extraArgs = []) {
  const r = spawnSync('helm', ['template', 'falcone', CHART_PATH, '-s', TEMPLATE, ...extraArgs], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  return extractBlockScalar(r.stdout, 'bootstrap.sh');
}

/** Extract a YAML literal block scalar (`<key>: |`) and dedent it. Regex only; no YAML lib. */
function extractBlockScalar(stream, key) {
  const lines = String(stream).split('\n');
  const start = lines.findIndex((l) => new RegExp(`^(\\s*)${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*\\|`).test(l));
  assert.ok(start >= 0, `expected a "${key}: |" block in the rendered ConfigMap`);
  const keyIndent = lines[start].match(/^(\s*)/)[1].length;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') { body.push(''); continue; }
    if (l.match(/^(\s*)/)[1].length <= keyIndent) break; // dedent → end of block
    body.push(l);
  }
  // strip the common (minimum) indentation of non-empty lines
  const min = Math.min(...body.filter((l) => l.trim()).map((l) => l.match(/^(\s*)/)[1].length));
  return body.map((l) => l.slice(min)).join('\n');
}

function bashSyntaxOk(script) {
  const f = resolve(tmpdir(), `bootstrap-bbx-${process.pid}-${Math.floor(performance.now())}.sh`);
  try {
    writeFileSync(f, script);
    const r = spawnSync('bash', ['-n', f], { encoding: 'utf8' });
    return { ok: r.status === 0, stderr: r.stderr };
  } finally {
    rmSync(f, { force: true });
  }
}

/** Count `ensure_apisix_route "..."` CALL-sites (the definition has no quote after the name). */
function reconcileCallSites(script) {
  return (script.match(/ensure_apisix_route\s+"/g) || []).length;
}

// -------------------------------------------------------------------------
// bbx-d2-01: standalone (default) skips the admin-API reconciliation
// -------------------------------------------------------------------------
test('bbx-d2-01: standalone default → zero reconcile call-sites, skip log, valid bash', SKIP, () => {
  const script = renderScript();
  assert.equal(reconcileCallSites(script), 0, 'standalone must emit zero ensure_apisix_route calls');
  assert.match(script, /APISIX_STAND_ALONE=true;\s*skipping APISIX admin-API route reconciliation/);
  const { ok, stderr } = bashSyntaxOk(script);
  assert.ok(ok, `rendered bootstrap.sh must be valid bash.\n${stderr}`);
});

// -------------------------------------------------------------------------
// bbx-d2-02: non-standalone preserves the admin-API reconciliation
// -------------------------------------------------------------------------
test('bbx-d2-02: APISIX_STAND_ALONE=false → reconcile call-sites present, valid bash', SKIP, () => {
  const script = renderScript(['--set', 'apisix.config.inline.APISIX_STAND_ALONE=false']);
  assert.ok(reconcileCallSites(script) > 0, 'non-standalone must reconcile routes via the admin API');
  const { ok, stderr } = bashSyntaxOk(script);
  assert.ok(ok, `rendered bootstrap.sh must be valid bash.\n${stderr}`);
});

// -------------------------------------------------------------------------
// bbx-d2-03: the auth-layer smoke step is defined and invoked before success
// -------------------------------------------------------------------------
test('bbx-d2-03: verify_auth_layer is defined and invoked in main before write_marker', SKIP, () => {
  const script = renderScript();
  assert.match(script, /verify_auth_layer\(\)\s*\{/, 'verify_auth_layer must be defined');
  // invoked after the reconcile phase and before the marker is written
  const order = /run_upgrade_reconciliation\s*\n\s*verify_auth_layer\s*\n\s*write_marker/;
  assert.match(script, order, 'main must call verify_auth_layer between reconcile and write_marker');
});

// -------------------------------------------------------------------------
// bbx-d2-04: the smoke step is fail-closed and checks realm + clients + superadmin
// -------------------------------------------------------------------------
test('bbx-d2-04: verify_auth_layer is fail-closed and checks realm/clients/superadmin', SKIP, () => {
  const script = renderScript();
  const fn = script.slice(script.indexOf('verify_auth_layer() {'));
  assert.match(fn, /admin\/realms\/\$KEYCLOAK_REALM_ID"/, 'must check the platform realm');
  assert.match(fn, /clients\?clientId=in-falcone-console/, 'must check the console client');
  assert.match(fn, /clients\?clientId=in-falcone-gateway/, 'must check the gateway client');
  assert.match(fn, /users\?username=\$KEYCLOAK_SUPERADMIN_USERNAME/, 'must check the superadmin user');
  assert.match(fn, /exit 1/, 'must exit non-zero when the auth layer is incomplete');
});
