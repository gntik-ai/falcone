/**
 * Black-box regression suite for spec change fix-platform-user-profile-unmanaged-attributes
 * (live E2E campaign 2026-06-17, finding A4).
 *
 * Drives the PUBLIC chart surface ONLY via `helm template`, extracts the rendered platform-realm
 * declarative user profile, and asserts that tenant scope attributes are preserved.
 *
 * Defect: the tenant-context / workspace-context client scopes map the user attributes tenant_id /
 * workspace_id into the token, but the platform realm ships a declarative user profile with
 * unmanagedAttributePolicy OFF — so any attribute not declared in the profile (incl. tenant_id) was
 * silently dropped and never appeared in the issued JWT. A platform user could not carry tenant scope.
 *
 * Fix: declare tenant_id and workspace_id as MANAGED attributes in the platform realm user profile,
 * admin-edit only (a user cannot self-assign tenant scope), so the values persist and surface in the
 * token without enabling arbitrary unmanaged attributes. The bootstrap PUTs the profile idempotently.
 *
 * Self-skips when `helm` is absent (repo precedent: pgvector/temporal-helm).
 *
 * Scenario coverage (capability: tenant-rbac / spec.md):
 *   bbx-a4-01  user profile declares tenant_id (admin-edit, viewable) so the mapper can read it
 *   bbx-a4-02  user profile declares workspace_id (admin-edit, viewable)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CHART_PATH = resolve(REPO_ROOT, 'charts', 'in-falcone');

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

function userProfile() {
  const cm = renderTemplate('templates/bootstrap-payload-configmap.yaml');
  return JSON.parse(extractBlockScalar(cm, 'user-profile.json'));
}

function findAttr(profile, name) {
  return (profile.attributes || []).find((a) => a.name === name);
}

// -------------------------------------------------------------------------
// bbx-a4-01 / 02: tenant scope attributes are declared and admin-edit only
// -------------------------------------------------------------------------
for (const [idx, name] of [['01', 'tenant_id'], ['02', 'workspace_id']]) {
  test(`bbx-a4-${idx}: user profile declares ${name} (viewable, admin-edit only)`, SKIP, () => {
    const attr = findAttr(userProfile(), name);
    assert.ok(attr, `platform realm user profile must declare the "${name}" attribute (else it is dropped)`);
    const view = attr.permissions?.view || [];
    const edit = attr.permissions?.edit || [];
    assert.ok(view.includes('admin') && view.includes('user'), `${name} must be viewable by admin and user`);
    assert.ok(edit.includes('admin'), `${name} must be admin-editable so ops can assign tenant scope`);
    assert.ok(!edit.includes('user'), `${name} MUST NOT be user-editable (a user cannot self-assign tenant scope)`);
  });
}
