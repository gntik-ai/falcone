/**
 * Black-box regression suite for spec change add-kind-profile-advanced-capabilities
 * (live E2E campaign 2026-06-17).
 *
 * Drives the PUBLIC chart surface ONLY via `helm template`, layering the compatibility advanced
 * kind overlay on the base kind profile and asserting that the core Flows (Temporal), MCP and
 * realtime-capable executor wiring remains intact. The acceptance scenarios themselves were live-verified on test-cluster-b
 * (flows .../task-types + .../flows → 200, /v1/mcp/.../servers → 200, realtime SSE subscribe +
 * `event: insert` delivery); this suite locks the overlay wiring deterministically.
 *
 * Self-skips when `helm` is absent (repo precedent: pgvector/temporal-helm).
 *
 * Scenario coverage (capability: tenant-provisioning / spec.md):
 *   bbx-adv-01  the advanced overlay enables Temporal + the workflow-worker (Flows backend)
 *   bbx-adv-02  the executor is wired with TEMPORAL_ADDRESS (Flows routes register) + MCP_ENABLED
 *   bbx-adv-03  MCP hosting is served by the core executor; no separate runtime Deployment renders
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CHART_PATH = resolve(REPO_ROOT, 'charts', 'in-falcone');
const BASE = resolve(REPO_ROOT, 'deploy', 'kind', 'values-kind.yaml');
const ADV = resolve(REPO_ROOT, 'deploy', 'kind', 'values-kind-advanced.yaml');

function helmAvailable() {
  return spawnSync('helm', ['version', '--short'], { encoding: 'utf8' }).status === 0;
}
const SKIP = helmAvailable() ? false : { skip: 'helm binary not available on PATH' };

let cached;
function render() {
  if (cached) return cached;
  const r = spawnSync('helm', ['template', 'falcone', CHART_PATH, '-f', BASE, '-f', ADV], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(r.status, 0, `helm template (base + advanced overlay) must exit 0.\nstderr: ${r.stderr}`);
  cached = r.stdout;
  return cached;
}
const named = (out, name) => new RegExp(`name:\\s*${name}\\b`).test(out);

// -------------------------------------------------------------------------
// bbx-adv-01: Temporal + workflow-worker (the Flows execution backend) are enabled
// -------------------------------------------------------------------------
test('bbx-adv-01: advanced overlay enables Temporal + the workflow-worker', SKIP, () => {
  const out = render();
  assert.ok(named(out, 'falcone-temporal-frontend'), 'Temporal frontend must render (Flows backend)');
  assert.ok(named(out, 'falcone-temporal-worker'), 'Temporal worker must render');
  assert.ok(named(out, 'falcone-workflow-worker'), 'the workflow-worker (DSL interpreter) must render');
});

// -------------------------------------------------------------------------
// bbx-adv-02: the executor is wired for Flows (TEMPORAL_ADDRESS) and MCP (MCP_ENABLED)
// -------------------------------------------------------------------------
test('bbx-adv-02: executor wired with TEMPORAL_ADDRESS (Flows register) + MCP_ENABLED', SKIP, () => {
  const out = render();
  assert.ok(named(out, 'falcone-control-plane-executor'), 'the executor must be enabled');
  // Flows routes (/v1/flows/workspaces/{ws}/*) register only when TEMPORAL_ADDRESS is present.
  assert.match(out, /TEMPORAL_ADDRESS["']?:\s*["']?falcone-temporal-frontend:7233/, 'executor must point at the Temporal frontend');
  assert.match(out, /MCP_ENABLED["']?:\s*["']?true/, 'executor must enable MCP hosting');
  // the data-plane wiring is still present (the overlay must not produce a dataless executor)
  assert.match(out, /CONTROL_PLANE_UPSTREAM/, 'executor must keep its control-plane upstream (data-plane fallthrough)');
});

// -------------------------------------------------------------------------
// bbx-adv-03: MCP hosting is served by the core executor
// -------------------------------------------------------------------------
test('bbx-adv-03: MCP route/RBAC render without a separate runtime Deployment', SKIP, () => {
  const out = render();
  const apisix = readFileSync(resolve(REPO_ROOT, 'deploy', 'kind', 'apisix', 'apisix.yaml'), 'utf8');
  assert.match(apisix, /id:\s*"2018-mcp"[\s\S]*uri:\s*"\/v1\/mcp\/\*"[\s\S]*falcone-control-plane-executor\.falcone\.svc\.cluster\.local:8080/, 'the standalone kind MCP gateway route must target the core executor');
  assert.match(out, /name:\s*falcone-mcp-runtime[\s\S]*kind:\s*ServiceAccount[\s\S]*name:\s*falcone-control-plane-executor/, 'MCP RBAC must bind the core executor service account');
  assert.doesNotMatch(out, /kind:\s*Deployment[\s\S]*name:\s*falcone-mcp-runtime\b/, 'MCP must not depend on a separate runtime Deployment');
});
