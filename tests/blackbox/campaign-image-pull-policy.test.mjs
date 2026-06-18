/**
 * Black-box regression suite for OpenSpec change fix-campaign-image-pull-policy
 * (live E2E campaign 2026-06-18, finding #561, epic #542).
 *
 * Parses the campaign harness files as plain text (no execution, no cluster) and asserts the
 * deploy contract that makes a rebuild always run the new code on the next deploy.
 *
 * Defect 1 (stale node cache): the campaign workloads pinned a reusable tag
 * (campaign-20260617) AND used `imagePullPolicy: IfNotPresent`, so rebuilding with the same tag
 * left the 9h-old image cached on the kind node — fixes silently did not take effect until a
 * manual `imagePullPolicy: Always` re-pull. Fix: the campaign-REBUILT workloads must pull on
 * every deploy (`Always`), which is robust against the local registry (localhost:30500).
 *
 * Defect 2 (helm ownership conflict): make-secrets.sh pre-created
 * `in-falcone-gateway-shared-secret`, which the chart now self-manages
 * (templates/gateway-shared-secret.yaml). `helm install` then aborts with "invalid ownership
 * metadata". Fix: make-secrets.sh must NOT actively create that Secret — the chart owns it.
 *
 * Scenario coverage (capability: control-plane-runtime / spec.md):
 *   bbx-561-01  the rebuilt executor (executor-demo.yaml) pulls Always (not IfNotPresent)
 *   bbx-561-02  the campaign control-plane + web-console images pull Always
 *   bbx-561-03  make-secrets.sh does not actively create in-falcone-gateway-shared-secret
 *   bbx-561-04  the MCP_SELF_BASE_URL env on the executor is preserved (no regression)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

const read = (rel) => readFileSync(resolve(REPO_ROOT, rel), 'utf8');

/** Strip `#`-comment lines so assertions are about ACTIVE shell statements only. */
function activeLines(text) {
  return text
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

// -------------------------------------------------------------------------
// bbx-561-01: the rebuilt executor pulls on every deploy
// -------------------------------------------------------------------------
test('bbx-561-01: executor-demo.yaml executor container uses imagePullPolicy: Always', () => {
  const yaml = read('deploy/kind/executor-demo.yaml');
  // The first imagePullPolicy after the executor image line (skipping comment lines) is the
  // executor container's effective policy.
  const after = yaml.slice(yaml.indexOf('in-falcone-control-plane-executor:'));
  const policy = after
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .map((l) => l.match(/^\s*imagePullPolicy:\s*(\S+)/))
    .find(Boolean);
  assert.ok(policy, 'executor container must declare an imagePullPolicy');
  assert.equal(policy[1], 'Always', 'rebuilt executor must pull Always (not the stale node cache)');
});

// -------------------------------------------------------------------------
// bbx-561-02: the campaign control-plane + web-console images pull Always
// -------------------------------------------------------------------------
test('bbx-561-02: values-campaign.yaml campaign images set pullPolicy: Always', () => {
  const lines = read('tests/live-campaign/values-campaign.yaml').split('\n');
  for (const comp of ['control-plane', 'web-console']) {
    const idx = lines.findIndex((l) => new RegExp(`repository:\\s*localhost:30500/in-falcone-${comp}\\b`).test(l));
    assert.ok(idx >= 0, `${comp} campaign image repository must be declared`);
    // The first pullPolicy after the repository line (within the image stanza, skipping comments)
    // is the effective policy for that component image.
    const policy = lines
      .slice(idx + 1)
      .filter((l) => !/^\s*#/.test(l))
      .map((l) => l.match(/^\s*pullPolicy:\s*(\S+)/))
      .find(Boolean);
    assert.ok(policy, `${comp} campaign image must declare a pullPolicy`);
    assert.equal(policy[1], 'Always', `${comp} campaign image must pull Always`);
  }
});

// -------------------------------------------------------------------------
// bbx-561-03: make-secrets.sh no longer creates the chart-owned gateway secret
// -------------------------------------------------------------------------
test('bbx-561-03: make-secrets.sh does not actively create in-falcone-gateway-shared-secret', () => {
  const active = activeLines(read('tests/live-campaign/make-secrets.sh'));
  assert.ok(
    !/in-falcone-gateway-shared-secret/.test(active),
    'no ACTIVE statement may create the chart-owned gateway secret (helm ownership conflict)',
  );
});

// -------------------------------------------------------------------------
// bbx-561-04: the MCP_SELF_BASE_URL env on the executor is preserved
// -------------------------------------------------------------------------
test('bbx-561-04: executor-demo.yaml still wires MCP_SELF_BASE_URL (no regression)', () => {
  const yaml = read('deploy/kind/executor-demo.yaml');
  assert.match(yaml, /MCP_SELF_BASE_URL/, 'MCP_SELF_BASE_URL env must be preserved');
});
