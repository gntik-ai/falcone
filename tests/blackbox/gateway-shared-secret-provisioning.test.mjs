/**
 * Black-box regression suite for OpenSpec change fix-apisix-gateway-shared-secret-provisioning
 * (live E2E campaign 2026-06-17, finding D3).
 *
 * Drives the PUBLIC chart surface ONLY via `helm template` as a child process. No internal
 * knowledge of the Go templates is used — assertions render the chart and inspect the rendered
 * Secret and the APISIX / executor Deployment env.
 *
 * Defect: the APISIX standalone config injects `x-gateway-auth: ${{GATEWAY_SHARED_SECRET}}` and
 * reads the value from its process env, but the chart never provisioned the env / a backing
 * Secret. APISIX failed to load config and CrashLooped:
 *   "failed to read local yaml config of apisix: ... can't find environment variable
 *    GATEWAY_SHARED_SECRET"
 * Verified live: an apisix pod with the real standalone route table and no env → Error; the same
 * pod with GATEWAY_SHARED_SECRET sourced from the chart Secret → Running.
 *
 * The suite self-skips when the `helm` binary is absent (repo precedent: pgvector/temporal-helm).
 *
 * Scenario coverage (capability: gateway / spec.md):
 *   bbx-d3-01  chart provisions a Secret `in-falcone-gateway-shared-secret` with a non-empty `secret`
 *   bbx-d3-02  apisix Deployment wires GATEWAY_SHARED_SECRET from that Secret via secretKeyRef
 *   bbx-d3-03  executor Deployment (when enabled) wires GATEWAY_SHARED_SECRET from the same Secret
 *   bbx-d3-04  gatewaySharedSecret.create=false → no chart-managed Secret is rendered (BYO)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CHART_PATH = resolve(REPO_ROOT, 'charts', 'in-falcone');
const SECRET_NAME = 'in-falcone-gateway-shared-secret';

function helmAvailable() {
  const r = spawnSync('helm', ['version', '--short'], { encoding: 'utf8' });
  return r.status === 0;
}
const SKIP = helmAvailable() ? false : { skip: 'helm binary not available on PATH' };

function helmTemplate(extraArgs = []) {
  return spawnSync('helm', ['template', 'falcone', CHART_PATH, ...extraArgs], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function splitDocs(stream) {
  return String(stream || '')
    .split(/^---\s*$/m)
    .map((d) => d.trim())
    .filter((d) => d.length > 0 && /(^|\n)kind:\s*\S/.test(d));
}

function docName(doc) {
  const m = doc.match(/(?:^|\n)metadata:\s*\n(?:\s+\S.*\n)*?\s+name:\s*(\S+)/);
  return m ? m[1] : '';
}

/** Does this Deployment doc wire GATEWAY_SHARED_SECRET from the shared Secret via secretKeyRef?
 *  (toYaml sorts keys, so within secretKeyRef `key` precedes `name`.) */
function wiresGatewaySecret(doc) {
  return /name:\s*GATEWAY_SHARED_SECRET[\s\S]{0,160}?secretKeyRef:[\s\S]{0,120}?name:\s*in-falcone-gateway-shared-secret/.test(
    doc,
  );
}

// -------------------------------------------------------------------------
// bbx-d3-01: chart provisions the backing Secret with a non-empty value
// -------------------------------------------------------------------------
test('bbx-d3-01: chart renders Secret in-falcone-gateway-shared-secret with a non-empty `secret`', SKIP, () => {
  const r = helmTemplate();
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  const secret = splitDocs(r.stdout).find(
    (d) => /(^|\n)kind:\s*Secret/.test(d) && docName(d) === SECRET_NAME,
  );
  assert.ok(secret, `expected a Secret named ${SECRET_NAME}`);
  const m = secret.match(/(?:^|\n)\s*secret:\s*"?([^"\n]+)"?/);
  assert.ok(m && m[1].trim().length >= 16, 'expected a non-empty generated `secret` value');
});

// -------------------------------------------------------------------------
// bbx-d3-02: APISIX consumes the secret (fixes the CrashLoop)
// -------------------------------------------------------------------------
test('bbx-d3-02: apisix Deployment wires GATEWAY_SHARED_SECRET via secretKeyRef', SKIP, () => {
  const r = helmTemplate();
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  const apisix = splitDocs(r.stdout).find(
    (d) => /(^|\n)kind:\s*Deployment/.test(d) && docName(d) === 'falcone-apisix',
  );
  assert.ok(apisix, 'expected a falcone-apisix Deployment');
  assert.ok(wiresGatewaySecret(apisix), 'apisix must source GATEWAY_SHARED_SECRET from the shared Secret');
});

// -------------------------------------------------------------------------
// bbx-d3-03: the executor consumes the same secret (gateway-trust end to end)
// -------------------------------------------------------------------------
test('bbx-d3-03: executor Deployment wires GATEWAY_SHARED_SECRET via secretKeyRef when enabled', SKIP, () => {
  const r = helmTemplate(['--set', 'controlPlaneExecutor.enabled=true']);
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  const exec = splitDocs(r.stdout).find(
    (d) => /(^|\n)kind:\s*Deployment/.test(d) && docName(d) === 'falcone-control-plane-executor',
  );
  assert.ok(exec, 'expected a falcone-control-plane-executor Deployment when enabled');
  assert.ok(wiresGatewaySecret(exec), 'executor must source GATEWAY_SHARED_SECRET from the shared Secret');
});

// -------------------------------------------------------------------------
// bbx-d3-04: BYO secret — create=false suppresses the chart-managed Secret
// -------------------------------------------------------------------------
test('bbx-d3-04: gatewaySharedSecret.create=false renders no chart-managed Secret', SKIP, () => {
  const r = helmTemplate(['--set', 'gatewaySharedSecret.create=false']);
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  const secret = splitDocs(r.stdout).find(
    (d) => /(^|\n)kind:\s*Secret/.test(d) && docName(d) === SECRET_NAME,
  );
  assert.equal(secret, undefined, 'no chart-managed gateway secret should render when create=false');
});
