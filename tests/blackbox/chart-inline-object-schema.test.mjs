/**
 * Black-box test for GitHub issue #276 / change fix-gateway-chart-values-schema-inline-config.
 *
 * Drives `helm template` as a child process against the public chart surface only.
 * No internal knowledge of the chart's Go templates is used — we only inspect
 * exit code and the rendered YAML.
 *
 * bbx-chart-inline-object-schema-01: helm template exits 0 when observability.config.inline.metricsStack is a nested object
 * bbx-chart-inline-object-schema-02: helm template exits 0 when webConsole.config.inline.auth is a nested object
 * bbx-chart-inline-object-schema-03: scalar inline values remain valid after the relaxation (no regression)
 * bbx-chart-inline-object-schema-04: rendered output contains at least one ConfigMap or Deployment (real render, not empty)
 * bbx-chart-inline-object-schema-05: helm lint exits 0
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CHART_PATH = resolve(REPO_ROOT, '..', 'falcone-charts', 'charts', 'in-falcone');

function helmTemplate(extraArgs = []) {
  const result = spawnSync('helm', ['template', 'falcone', CHART_PATH, ...extraArgs], {
    encoding: 'utf8',
    cwd: REPO_ROOT
  });
  return result;
}

function helmLint(extraArgs = []) {
  const result = spawnSync('helm', ['lint', CHART_PATH, ...extraArgs], {
    encoding: 'utf8',
    cwd: REPO_ROOT
  });
  return result;
}

// -------------------------------------------------------------------------
// bbx-chart-inline-object-schema-01: nested object in observability.config.inline.metricsStack
// -------------------------------------------------------------------------
test('bbx-chart-inline-object-schema-01: helm template exits 0 — observability.config.inline.metricsStack nested object', () => {
  const result = helmTemplate();
  const errMsg = result.stderr ? result.stderr.trim() : '';
  assert.equal(
    result.status,
    0,
    `helm template must exit 0 but got ${result.status}.\nstderr: ${errMsg}`
  );
  assert.equal(
    errMsg.includes('metricsStack'),
    false,
    `schema error for metricsStack must not appear in output.\nstderr: ${errMsg}`
  );
});

// -------------------------------------------------------------------------
// bbx-chart-inline-object-schema-02: nested object in webConsole.config.inline.auth
// -------------------------------------------------------------------------
test('bbx-chart-inline-object-schema-02: helm template exits 0 — webConsole.config.inline.auth nested object', () => {
  const result = helmTemplate();
  const errMsg = result.stderr ? result.stderr.trim() : '';
  assert.equal(
    result.status,
    0,
    `helm template must exit 0 but got ${result.status}.\nstderr: ${errMsg}`
  );
  assert.equal(
    errMsg.includes('/webConsole/config/inline/auth'),
    false,
    `schema error for webConsole.config.inline.auth must not appear.\nstderr: ${errMsg}`
  );
});

// -------------------------------------------------------------------------
// bbx-chart-inline-object-schema-03: scalar inline values remain valid (no regression)
// -------------------------------------------------------------------------
test('bbx-chart-inline-object-schema-03: scalar inline config values remain valid after relaxation', () => {
  const result = helmTemplate([
    '--set', 'observability.config.inline.scrapeModel=push',
    '--set', 'webConsole.config.inline.publicPath=/console'
  ]);
  const errMsg = result.stderr ? result.stderr.trim() : '';
  assert.equal(
    result.status,
    0,
    `helm template with scalar inline values must exit 0 but got ${result.status}.\nstderr: ${errMsg}`
  );
});

// -------------------------------------------------------------------------
// bbx-chart-inline-object-schema-04: rendered output is non-empty
// -------------------------------------------------------------------------
test('bbx-chart-inline-object-schema-04: rendered output contains at least one ConfigMap or Deployment', () => {
  const result = helmTemplate();
  assert.equal(result.status, 0, `helm template must exit 0 before checking output`);
  const hasExpectedKind =
    result.stdout.includes('kind: ConfigMap') || result.stdout.includes('kind: Deployment');
  assert.equal(
    hasExpectedKind,
    true,
    'rendered output must contain at least one ConfigMap or Deployment'
  );
});

// -------------------------------------------------------------------------
// bbx-chart-inline-object-schema-05: helm lint exits 0
// -------------------------------------------------------------------------
test('bbx-chart-inline-object-schema-05: helm lint exits 0', () => {
  const result = helmLint();
  const errMsg = result.stderr ? result.stderr.trim() : '';
  assert.equal(
    result.status,
    0,
    `helm lint must exit 0 but got ${result.status}.\nstderr: ${errMsg}\nstdout: ${result.stdout}`
  );
});
