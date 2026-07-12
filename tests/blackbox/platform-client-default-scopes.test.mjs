/**
 * Black-box regression suite for spec change fix-platform-client-default-scopes
 * (live E2E campaign 2026-06-17, finding A2).
 *
 * Drives the PUBLIC chart surface ONLY via `helm template`, extracts the rendered Keycloak client
 * payloads and the bootstrap script, and asserts their shape.
 *
 * Defect: the in-falcone-console / in-falcone-gateway clients were created with a defaultClientScopes
 * list of ONLY the custom context scopes — which overrides Keycloak's realm-default scopes, so
 * issued tokens carried no realm_access.roles and every role check (incl. superadmin) 403'd. The
 * platform realm advertises roles/basic/profile (verified live via OIDC discovery scopes_supported),
 * so referencing them is valid.
 *
 * Fix: add the standard default scopes (roles, basic, profile) to both client payloads, and add an
 * idempotent ensure_client_default_scopes step that back-fills them on existing deployments
 * (create-only client provisioning never updates an existing client).
 *
 * Self-skips when `helm` is absent (repo precedent: pgvector/temporal-helm).
 *
 * Scenario coverage (capability: tenant-rbac / spec.md):
 *   bbx-a2-01  console client payload includes roles/basic/profile (custom scopes preserved)
 *   bbx-a2-02  gateway client payload includes roles/basic/profile (custom scopes preserved)
 *   bbx-a2-03  bootstrap script back-fills the scopes idempotently for each client; valid bash
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
const STANDARD_SCOPES = ['roles', 'basic', 'profile'];
const CUSTOM_SCOPES = ['tenant-context', 'workspace-context', 'plan-context', 'workspace-roles'];

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

function clientDefaultScopes(clientId) {
  const cm = renderTemplate('templates/bootstrap-payload-configmap.yaml');
  const json = extractBlockScalar(cm, `client-${clientId}.json`);
  return JSON.parse(json).defaultClientScopes || [];
}

function bashSyntaxOk(script) {
  const f = resolve(tmpdir(), `a2-bbx-${process.pid}-${Math.floor(performance.now())}.sh`);
  try {
    writeFileSync(f, script);
    return spawnSync('bash', ['-n', f], { encoding: 'utf8' });
  } finally {
    rmSync(f, { force: true });
  }
}

// -------------------------------------------------------------------------
// bbx-a2-01 / 02: client payloads carry the standard scopes + keep the custom ones
// -------------------------------------------------------------------------
for (const clientId of ['in-falcone-console', 'in-falcone-gateway']) {
  const idx = clientId === 'in-falcone-console' ? '01' : '02';
  test(`bbx-a2-${idx}: ${clientId} payload includes roles/basic/profile (custom scopes preserved)`, SKIP, () => {
    const scopes = clientDefaultScopes(clientId);
    for (const s of STANDARD_SCOPES) {
      assert.ok(scopes.includes(s), `${clientId} defaultClientScopes must include "${s}" (got ${JSON.stringify(scopes)})`);
    }
    for (const s of CUSTOM_SCOPES) {
      assert.ok(scopes.includes(s), `${clientId} must still include custom scope "${s}"`);
    }
  });
}

// -------------------------------------------------------------------------
// bbx-a2-03: the bootstrap back-fills scopes idempotently for each provisioned client
// -------------------------------------------------------------------------
test('bbx-a2-03: bootstrap idempotently assigns default scopes per client; valid bash', SKIP, () => {
  const script = extractBlockScalar(renderTemplate('templates/bootstrap-script-configmap.yaml'), 'bootstrap.sh');
  assert.match(script, /ensure_client_default_scopes\(\)\s*\{/, 'must define ensure_client_default_scopes');
  // assigns via the Keycloak REST default-client-scopes sub-resource (PUT is idempotent)
  assert.match(script, /clients\/\$client_uuid\/default-client-scopes\/\$scope_id/, 'must PUT to the default-client-scopes sub-resource');
  // invoked for both platform clients with the standard scopes
  for (const cid of ['in-falcone-console', 'in-falcone-gateway']) {
    assert.match(
      script,
      new RegExp(`ensure_client_default_scopes "\\$token" "${cid}" roles basic profile`),
      `must back-fill scopes for ${cid}`,
    );
  }
  const r = bashSyntaxOk(script);
  assert.equal(r.status, 0, `rendered bootstrap.sh must be valid bash.\n${r.stderr}`);
});
