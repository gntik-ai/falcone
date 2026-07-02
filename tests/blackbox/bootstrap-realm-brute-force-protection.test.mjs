/**
 * Black-box regression suite for spec change add-brute-force-protection (#668).
 *
 * Drives the PUBLIC chart surface ONLY via `helm template` as a child process and asserts:
 *  - the rendered bootstrap PAYLOAD realm.json carries `bruteForceProtected: true` + sane thresholds
 *    (so a FRESH install creates the platform realm with brute-force detection ON);
 *  - the payload also emits a standalone `brute-force.json` partial realm rep for the ensure step;
 *  - the rendered bootstrap SCRIPT defines `ensure_keycloak_brute_force` as an idempotent PUT onto
 *    the realm and INVOKES it in the bootstrap flow (right after the user-profile relax step) — so an
 *    ALREADY-PROVISIONED platform realm is retrofitted on upgrade (ensure_keycloak_realm short-circuits
 *    once the realm exists, so a payload-only change would not retrofit it).
 *
 * Defect: Keycloak defaults `bruteForceProtected` to FALSE; the chart bootstrap created the platform
 * realm without setting it, so the realm accepted unlimited wrong-password attempts (no lockout).
 *
 * Self-skips when `helm` is absent (repo precedent: pgvector/temporal-helm; bootstrap-job-standalone-apisix).
 *
 * Scenario coverage (capability: tenant-provisioning / spec.md):
 *   bbx-bf-01  payload realm.json has bruteForceProtected:true + failureFactor/lockout thresholds
 *   bbx-bf-02  payload emits brute-force.json (minimal partial realm rep with `realm` + the knobs)
 *   bbx-bf-03  script defines ensure_keycloak_brute_force (idempotent PUT to /admin/realms/$REALM_ID)
 *              AND invokes it after ensure_keycloak_user_profile; rendered bootstrap.sh is valid bash
 *   bbx-bf-04  thresholds are deployment-configurable: an override flows through to realm.json
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
const CHART_PATH = resolve(REPO_ROOT, 'charts', 'in-falcone');
const PAYLOAD_TEMPLATE = 'templates/bootstrap-payload-configmap.yaml';
const SCRIPT_TEMPLATE = 'templates/bootstrap-script-configmap.yaml';

function helmAvailable() {
  return spawnSync('helm', ['version', '--short'], { encoding: 'utf8' }).status === 0;
}
const SKIP = helmAvailable() ? false : { skip: 'helm binary not available on PATH' };

function render(template, extraArgs = []) {
  const r = spawnSync('helm', ['template', 'falcone', CHART_PATH, '-s', template, ...extraArgs], {
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
  const nonEmpty = body.filter((l) => l.trim());
  const min = nonEmpty.length ? Math.min(...nonEmpty.map((l) => l.match(/^(\s*)/)[1].length)) : 0;
  return body.map((l) => l.slice(min)).join('\n');
}

function bashSyntaxOk(script) {
  const f = resolve(tmpdir(), `bootstrap-bf-${process.pid}-${Math.floor(performance.now())}.sh`);
  try {
    writeFileSync(f, script);
    const r = spawnSync('bash', ['-n', f], { encoding: 'utf8' });
    return { ok: r.status === 0, stderr: r.stderr };
  } finally {
    rmSync(f, { force: true });
  }
}

// -------------------------------------------------------------------------
// bbx-bf-01: the realm-create payload enables brute-force detection
// -------------------------------------------------------------------------
test('bbx-bf-01: realm.json sets bruteForceProtected:true + sane thresholds', SKIP, () => {
  const realmJson = JSON.parse(extractBlockScalar(render(PAYLOAD_TEMPLATE), 'realm.json'));

  // Cardinal assertion: the platform realm is created with brute-force detection ON.
  assert.equal(realmJson.bruteForceProtected, true, 'realm.json MUST set bruteForceProtected:true');

  // A meaningful, verifiable failure factor and a temporary lockout window.
  assert.equal(typeof realmJson.failureFactor, 'number');
  assert.ok(realmJson.failureFactor > 0 && realmJson.failureFactor <= 30,
    `failureFactor must be a sane threshold ≤ 30 (got ${realmJson.failureFactor})`);
  assert.equal(realmJson.failureFactor, 10, 'default failureFactor is 10');
  assert.equal(realmJson.maxFailureWaitSeconds, 900, 'lockout window present');
  assert.equal(realmJson.permanentLockout, false, 'lockout is temporary by default');

  // The realm's existing identity fields are preserved (no regression), and the nested authoring
  // sub-block `bruteForce` is NOT leaked into the KC payload (KC expects top-level fields).
  assert.equal(realmJson.realm, 'in-falcone-platform');
  assert.equal(realmJson.bruteForce, undefined, 'the nested authoring key must not leak into realm.json');
});

// -------------------------------------------------------------------------
// bbx-bf-02: a standalone partial realm rep is emitted for the ensure step
// -------------------------------------------------------------------------
test('bbx-bf-02: payload emits brute-force.json (partial realm rep for the idempotent PUT)', SKIP, () => {
  const bf = JSON.parse(extractBlockScalar(render(PAYLOAD_TEMPLATE), 'brute-force.json'));
  // KC's realm PUT needs the realm name to resolve the target; the rest are the knobs.
  assert.equal(bf.realm, 'in-falcone-platform', 'partial rep must name the realm so KC resolves it');
  assert.equal(bf.bruteForceProtected, true);
  assert.equal(bf.failureFactor, 10);
  assert.equal(bf.maxFailureWaitSeconds, 900);
  assert.equal(bf.permanentLockout, false);
});

// -------------------------------------------------------------------------
// bbx-bf-03: the script defines + invokes an idempotent brute-force ensure step
// -------------------------------------------------------------------------
test('bbx-bf-03: ensure_keycloak_brute_force is defined (PUT) and invoked after user-profile; valid bash', SKIP, () => {
  const script = extractBlockScalar(render(SCRIPT_TEMPLATE), 'bootstrap.sh');

  // Defined as a function that PUTs the partial rep onto the realm (retrofits an existing realm).
  assert.match(script, /ensure_keycloak_brute_force\(\)\s*\{/, 'ensure_keycloak_brute_force must be defined');
  const fn = script.slice(script.indexOf('ensure_keycloak_brute_force() {'));
  assert.match(fn, /-X PUT/, 'must be a PUT (idempotent retrofit)');
  assert.match(fn, /admin\/realms\/\$KEYCLOAK_REALM_ID"/, 'must target the realm by id');
  assert.match(fn, /brute-force\.json/, 'must send the brute-force.json partial rep');
  assert.match(fn, /exit 1/, 'must fail closed on a non-2xx PUT');

  // Invoked in the bootstrap flow right after the user-profile relax step (so it runs whether or not
  // the realm pre-existed — ensure_keycloak_realm short-circuits once the realm exists).
  assert.match(
    script,
    /ensure_keycloak_user_profile\s+"\$token"\s*\n\s*ensure_keycloak_brute_force\s+"\$token"/,
    'ensure_keycloak_brute_force must be invoked immediately after ensure_keycloak_user_profile',
  );

  const { ok, stderr } = bashSyntaxOk(script);
  assert.ok(ok, `rendered bootstrap.sh must be valid bash.\n${stderr}`);
});

// -------------------------------------------------------------------------
// bbx-bf-04: the thresholds are deployment-configurable (override flows through)
// -------------------------------------------------------------------------
test('bbx-bf-04: a values override changes the rendered failureFactor', SKIP, () => {
  const realmJson = JSON.parse(extractBlockScalar(
    render(PAYLOAD_TEMPLATE, ['--set', 'bootstrap.oneShot.keycloak.realm.bruteForce.failureFactor=7']),
    'realm.json',
  ));
  assert.equal(realmJson.failureFactor, 7, 'an operator override of failureFactor must flow into realm.json');
  assert.equal(realmJson.bruteForceProtected, true, 'protection stays ON when only a threshold is overridden');
});
