/**
 * Black-box regression suite for spec change fix-superadmin-created-disabled
 * (live E2E campaign 2026-06-17, finding A1).
 *
 * Drives the PUBLIC chart surface ONLY via `helm template`, extracts the rendered Keycloak
 * superadmin payload and the bootstrap script, and asserts their shape.
 *
 * Defect: the superadmin UserRepresentation was POSTed to Keycloak without `enabled`, so the
 * account was created DISABLED -> login returned 401 "Account disabled" until manually enabled.
 *
 * Fix: the superadmin payload sets enabled/emailVerified/requiredActions, and the bootstrap
 * idempotently PUTs that account state to the user resource so an already-disabled superadmin on
 * an existing deployment is healed on re-bootstrap (create-only provisioning never updates a user).
 *
 * Self-skips when `helm` is absent (repo precedent: pgvector/temporal-helm).
 *
 * Scenario coverage (capability: tenant-rbac / spec.md):
 *   bbx-a1-01  superadmin.json payload is enabled/emailVerified with no required actions
 *   bbx-a1-02  bootstrap script idempotently back-fills the enabled account state; valid bash
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

function helmAvailable() {
  return spawnSync('helm', ['version', '--short'], { encoding: 'utf8' }).status === 0;
}
const SKIP = helmAvailable() ? false : { skip: 'helm binary not available on PATH' };

function renderTemplate(template) {
  const r = spawnSync('helm', ['template', 'falcone', CHART_PATH, '-s', template], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  return r.stdout;
}

/** Extract a YAML literal block scalar (`<key>: |`) and dedent it. Regex only; no YAML lib. */
function extractBlockScalar(stream, key) {
  const lines = String(stream).split('\n');
  const keyRe = new RegExp(`^(\\s*)${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*\\|`);
  const start = lines.findIndex((l) => keyRe.test(l));
  assert.ok(start >= 0, `expected a "${key}: |" block`);
  const keyIndent = lines[start].match(/^(\s*)/)[1].length;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') { body.push(''); continue; }
    if (l.match(/^(\s*)/)[1].length <= keyIndent) break;
    body.push(l);
  }
  const min = Math.min(...body.filter((l) => l.trim()).map((l) => l.match(/^(\s*)/)[1].length));
  return body.map((l) => l.slice(min)).join('\n');
}

function bashSyntaxOk(script) {
  const f = resolve(tmpdir(), `a1-bbx-${process.pid}-${Math.floor(performance.now())}.sh`);
  try {
    writeFileSync(f, script);
    return spawnSync('bash', ['-n', f], { encoding: 'utf8' });
  } finally {
    rmSync(f, { force: true });
  }
}

// -------------------------------------------------------------------------
// bbx-a1-01: the superadmin create payload is enabled, verified, and has no pending actions
// -------------------------------------------------------------------------
test('bbx-a1-01: superadmin.json is enabled/emailVerified with no required actions', SKIP, () => {
  const cm = renderTemplate('templates/bootstrap-payload-configmap.yaml');
  const superadmin = JSON.parse(extractBlockScalar(cm, 'superadmin.json'));
  assert.equal(superadmin.enabled, true, 'superadmin must be created enabled (else login 401 "Account disabled")');
  assert.equal(superadmin.emailVerified, true, 'superadmin email must be pre-verified');
  assert.ok(Array.isArray(superadmin.requiredActions), 'requiredActions must be an explicit array');
  assert.equal(superadmin.requiredActions.length, 0, 'superadmin must have no pending required actions');
});

// -------------------------------------------------------------------------
// bbx-a1-02: the bootstrap heals an already-disabled superadmin idempotently
// -------------------------------------------------------------------------
test('bbx-a1-02: bootstrap back-fills the enabled account state on the user resource; valid bash', SKIP, () => {
  const script = extractBlockScalar(renderTemplate('templates/bootstrap-script-configmap.yaml'), 'bootstrap.sh');
  // a PUT to the user resource (not a sub-resource) carrying enabled:true must precede the
  // password reset, so a re-bootstrap of an older deployment re-enables the account.
  const enableIdx = script.search(/--data '\{"enabled":true,"emailVerified":true,"requiredActions":\[\]\}'/);
  assert.ok(enableIdx >= 0, 'must PUT {"enabled":true,...} to heal an existing disabled superadmin');
  assert.match(
    script,
    /users\/\$user_id"\s*>\/dev\/null/,
    'the enable PUT must target the user resource (.../users/$user_id)',
  );
  const resetIdx = script.search(/users\/\$user_id\/reset-password/);
  assert.ok(resetIdx > enableIdx, 'the enable PUT must run before the password reset');
  const r = bashSyntaxOk(script);
  assert.equal(r.status, 0, `rendered bootstrap.sh must be valid bash.\n${r.stderr}`);
});
