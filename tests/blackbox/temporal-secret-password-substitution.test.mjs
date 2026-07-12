/**
 * Black-box test suite for spec change fix-temporal-secret-password-substitution
 * (live E2E campaign, GitHub issue #623).
 *
 * Drives the PUBLIC chart surface ONLY via `helm template` / `helm lint` as a child process.
 * No internal knowledge of the Go templates is used — assertions inspect the rendered YAML.
 *
 * Defect: the chart's secure way to give Temporal its Postgres password
 * (temporal.persistence.existingSecret) did NOT work — the config ConfigMap rendered
 * `password: "${POSTGRES_PWD}"` LITERALLY, and the plain temporalio/server image does not expand
 * env in its config file, so the literal string was used as the password and the server pods
 * crash-looped with "no usable database connection". The only working alternative leaked the real
 * password into an inspectable ConfigMap. Fix: render a __TEMPORAL_DB_PASSWORD__ placeholder (never
 * plaintext) in the ConfigMap when existingSecret is set, and substitute it from the POSTGRES_PWD
 * env (sed-escaped) in the server start wrapper, into a writable in-pod copy.
 *
 * The suite self-skips when `helm` is not on PATH (repo precedent: flows-temporal-helm).
 *
 * Scenario coverage (capability: deployment / spec.md):
 *   bbx-623-01  existingSecret → ConfigMap renders the placeholder, not plaintext, not ${POSTGRES_PWD}
 *   bbx-623-02  the server start wrapper substitutes __TEMPORAL_DB_PASSWORD__ from POSTGRES_PWD
 *   bbx-623-03  POSTGRES_PWD on each role Deployment is sourced from the existingSecret via secretKeyRef
 *   bbx-623-04  default core install uses the canonical Secret and never renders plaintext
 *   bbx-623-05  helm lint exits 0 with existingSecret configured
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CHART_PATH = resolve(REPO_ROOT, 'charts', 'in-falcone');

const SECRET = 'in-falcone-postgresql';
const KEY = 'POSTGRESQL_PASSWORD';

function helmAvailable() {
  return spawnSync('helm', ['version', '--short'], { encoding: 'utf8' }).status === 0;
}
const SKIP = helmAvailable() ? false : { skip: 'helm binary not available on PATH' };

function helm(args) {
  return spawnSync('helm', args, { encoding: 'utf8', cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });
}
function showOnly(file, extra = []) {
  const r = helm(['template', 'falcone', CHART_PATH, ...extra, '--show-only', `templates/temporal/${file}`]);
  assert.equal(r.status, 0, `helm template ${file} must exit 0.\nstderr: ${r.stderr}`);
  return r.stdout;
}
const withSecret = ['--set', `temporal.persistence.existingSecret=${SECRET}`,
  '--set', `temporal.persistence.passwordSecretKey=${KEY}`];

test('bbx-623-01 existingSecret → ConfigMap renders a placeholder, never plaintext', SKIP, () => {
  const cm = showOnly('config.yaml', withSecret);
  assert.match(cm, /password:\s*"__TEMPORAL_DB_PASSWORD__"/,
    'with existingSecret the config must render the __TEMPORAL_DB_PASSWORD__ placeholder');
  // The literal, unexpanded ${POSTGRES_PWD} (the original defect) must be gone.
  assert.doesNotMatch(cm, /\$\{POSTGRES_PWD\}/,
    'the unexpanded ${POSTGRES_PWD} literal must NOT appear (it was used verbatim as the password)');
  // No inline default password leaks into the ConfigMap on the secret path.
  assert.doesNotMatch(cm, /password:\s*"temporal"/,
    'a plaintext password must never appear in the ConfigMap when existingSecret is set');
});

test('bbx-623-02 the server start wrapper substitutes the placeholder from POSTGRES_PWD', SKIP, () => {
  const dep = showOnly('deployments.yaml', withSecret);
  // The wrapper sed-substitutes the placeholder using the POSTGRES_PWD env (escaped for any value).
  assert.match(dep, /__TEMPORAL_DB_PASSWORD__\/\$\{PWD_ESC\}/,
    'the start wrapper must substitute __TEMPORAL_DB_PASSWORD__');
  assert.match(dep, /PWD_ESC=\$\(printf '%s' "\$\{POSTGRES_PWD\}"/,
    'the wrapper must derive the replacement from the POSTGRES_PWD env, sed-escaped');
});

test('bbx-623-03 POSTGRES_PWD is sourced from the existingSecret via secretKeyRef', SKIP, () => {
  const dep = showOnly('deployments.yaml', withSecret);
  // Each role Deployment must inject POSTGRES_PWD from the secret (never an inline value).
  const occurrences = dep.match(/name:\s*POSTGRES_PWD\b/g) || [];
  assert.ok(occurrences.length >= 4, `expected POSTGRES_PWD on >=4 role Deployments, found ${occurrences.length}`);
  assert.match(dep, new RegExp(`secretKeyRef:[\\s\\S]*?name:\\s*"?${SECRET}"?`),
    'POSTGRES_PWD must come from the existingSecret');
  assert.match(dep, new RegExp(`key:\\s*"?${KEY}"?`), 'POSTGRES_PWD must use the configured passwordSecretKey');
});

test('bbx-623-04 default core install uses the canonical Secret and never renders plaintext', SKIP, () => {
  const cm = showOnly('config.yaml');
  assert.match(cm, /password:\s*"__TEMPORAL_DB_PASSWORD__"/,
    'the core default must use the placeholder backed by the canonical Secret');
  assert.doesNotMatch(cm, /password:\s*"temporal"/,
    'the default install must not leak the historical inline password into the ConfigMap');
});

test('bbx-623-05 helm lint exits 0 with existingSecret configured', SKIP, () => {
  const r = helm(['lint', CHART_PATH, ...withSecret]);
  assert.equal(r.status, 0, `helm lint must exit 0.\nstderr: ${r.stderr}\nstdout: ${r.stdout}`);
});
