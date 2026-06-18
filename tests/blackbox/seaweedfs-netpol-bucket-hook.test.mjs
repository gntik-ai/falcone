/**
 * Black-box tests for fix-seaweedfs-netpol-bucket-hook (P1, live E2E re-run 2026-06-18
 * DEP-SWFS-NETPOL).
 *
 * Defect: the Falcone `seaweedfs-internal-only` NetworkPolicy restricted the storage
 * tier's master/filer ports to pods labeled `app.kubernetes.io/name: seaweedfs`, but the
 * UPSTREAM subchart's post-install bucket-provisioning hook (`{release}-bucket-hook`)
 * carries only `app.kubernetes.io/instance`. On a NetworkPolicy-ENFORCING CNI the hook's
 * traffic to the master/filer was dropped → it hung → `helm install` timed out. The
 * campaign worked around it by disabling the netpol entirely.
 *
 * Fix: the netpol admits the bucket-hook narrowly by its Job-name label (legacy + batch/v1)
 * on the intra-SeaweedFS ports, so a from-scratch install completes without disabling it.
 *
 * Tests the rendered chart via `helm template` (self-skips if helm is absent — repo
 * precedent), with a static template assertion as a hermetic fallback.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHART = resolve(REPO_ROOT, 'charts', 'in-falcone');
const NETPOL_TPL = resolve(CHART, 'templates', 'seaweedfs-networkpolicy.yaml');

function helmAvailable() {
  return spawnSync('helm', ['version', '--short'], { encoding: 'utf8' }).status === 0;
}
const SKIP = helmAvailable() ? false : { skip: 'helm binary not available on PATH' };

// Hermetic: the template references the bucket-hook Job-name selector.
test('bbx-swfs-netpol-01: the netpol template admits the bucket-hook by Job-name label', () => {
  const tpl = readFileSync(NETPOL_TPL, 'utf8');
  assert.match(tpl, /job-name: \{\{ \.Release\.Name \}\}-bucket-hook/, 'legacy job-name selector must be present');
  assert.match(tpl, /batch\.kubernetes\.io\/job-name: \{\{ \.Release\.Name \}\}-bucket-hook/, 'batch/v1 job-name selector must be present');
});

// Rendered: the bucket-hook selector appears in the seaweedfs netpol ingress.
test('bbx-swfs-netpol-02: rendered netpol allows {release}-bucket-hook on the storage tier', SKIP, () => {
  const r = spawnSync('helm', [
    'template', 'rel', CHART,
    '--set', 'seaweedfs.enabled=true',
    '--set', 'seaweedfs.networkPolicy.enabled=true',
    '--show-only', 'templates/seaweedfs-networkpolicy.yaml',
  ], { encoding: 'utf8' });
  assert.equal(r.status, 0, `helm template failed: ${r.stderr}`);
  assert.match(r.stdout, /kind: NetworkPolicy/);
  assert.match(r.stdout, /rel-bucket-hook/, 'rendered netpol must reference rel-bucket-hook');
});
