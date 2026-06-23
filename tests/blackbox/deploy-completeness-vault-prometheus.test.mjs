/**
 * Black-box tests for the deployment-completeness gaps (b) + (c)
 * (add-deploy-completeness-cluster, #562; live E2E campaign 2026-06-18).
 *
 * (b) The secret store (OpenBao, formerly Vault) is out-of-scope on the kind/campaign profile:
 *     cert-manager is absent (so enabling it in the default TLS mode aborts the release) AND the
 *     secret store is a deliberate, separate opt-in. The pragmatic resolution: the secret store
 *     stays DISABLED on the kind/campaign values. Asserted by parsing the campaign values +
 *     rendering the chart with the kind values: openbao.enabled is false, NO secret-store workload
 *     renders, and NEITHER the hashicorp/vault NOR the openbao/openbao image appears.
 *
 * (c) The Prometheus scrape config previously covered ONLY control-plane, cp-executor,
 *     and apisix (3 targets, #499). Widen it so it covers any Falcone component that
 *     exposes a Prometheus /metrics endpoint — via a Kubernetes pod-discovery scrape
 *     job keyed on the `prometheus.io/scrape` annotation, scoped to the release
 *     namespace, with the metrics-exposing wrappers (control-plane, cp-executor)
 *     carrying that annotation. workflow-worker is DELIBERATELY skipped: its HTTP
 *     server serves only /livez + /readyz (NO /metrics) — verified from
 *     services/workflow-worker/src/worker.ts.
 *
 * Self-skips when `helm` is absent (repo precedent: vault-secrets-backend-kind).
 *
 * bbx-562-vault-01: campaign values keep the secret store disabled (opt-out, separate decision)
 * bbx-562-vault-02: rendering the chart with the kind values renders NO secret-store workload and
 *                   neither the hashicorp/vault nor the openbao/openbao image
 * bbx-562-prom-01:  the scrape config still covers control-plane, cp-executor, apisix
 * bbx-562-prom-02:  a kubernetes pod-discovery scrape job widens coverage beyond the 3 static targets
 * bbx-562-prom-03:  the metrics-exposing components carry the prometheus.io/scrape annotation
 * bbx-562-prom-04:  workflow-worker (no /metrics) is NOT annotated for scraping
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CHART_PATH = resolve(REPO_ROOT, 'charts', 'in-falcone');
const KIND_VALUES = resolve(REPO_ROOT, 'deploy', 'kind', 'values-kind.yaml');
const CAMPAIGN_VALUES = resolve(REPO_ROOT, 'tests', 'live-campaign', 'values-campaign.yaml');

function helmAvailable() {
  return spawnSync('helm', ['version', '--short'], { encoding: 'utf8' }).status === 0;
}
const SKIP = helmAvailable() ? false : { skip: 'helm binary not available on PATH' };

function helmTemplate(extraArgs = []) {
  const r = spawnSync('helm', ['template', 'falcone', CHART_PATH, ...extraArgs], {
    encoding: 'utf8', cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  return r.stdout;
}

function splitDocs(stream) {
  return String(stream || '')
    .split(/^---\s*$/m).map((d) => d.trim())
    .filter((d) => d.length > 0 && /(^|\n)kind:\s*\S/.test(d));
}
function docsOfKind(stream, kind) {
  return splitDocs(stream).filter((d) => new RegExp(`(^|\\n)kind:\\s*${kind}\\b`).test(d));
}

// Pull the rendered prometheus.yml out of the ConfigMap doc (data."prometheus.yml": |).
function renderedPrometheusYml(stream) {
  const cm = docsOfKind(stream, 'ConfigMap').find((d) => /name:\s*falcone-prometheus-config/.test(d));
  assert.ok(cm, 'the prometheus-config ConfigMap must render');
  const lines = cm.split('\n');
  const idx = lines.findIndex((l) => /^\s*prometheus\.yml:\s*\|/.test(l));
  assert.ok(idx >= 0, 'expected a prometheus.yml literal block');
  const indent = lines[idx].search(/\S/);
  const body = [];
  for (let i = idx + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') { body.push(''); continue; }
    if (lines[i].search(/\S/) <= indent) break;
    body.push(lines[i]);
  }
  const minIndent = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)));
  return body.map((l) => l.slice(minIndent)).join('\n');
}

// -------------------------------------------------------------------------
// (b) Vault out-of-scope on the kind/campaign profile
// -------------------------------------------------------------------------
test('bbx-562-vault-01: campaign values keep the secret store disabled (opt-out, separate decision)', () => {
  const src = readFileSync(CAMPAIGN_VALUES, 'utf8');
  // The campaign overlay must pin openbao.enabled: false (an openbao: stanza with enabled: false).
  assert.match(src, /\nopenbao:\s*\n(?:[^\n]*\n)*?\s*enabled:\s*false/, 'campaign values must keep openbao.enabled: false');
});

test('bbx-562-vault-02: chart rendered with kind values renders NO secret-store workload or image', SKIP, () => {
  const out = helmTemplate(['-f', KIND_VALUES]);
  const secretStoreWorkloads = [...docsOfKind(out, 'StatefulSet'), ...docsOfKind(out, 'Deployment')]
    .filter((d) => /name:\s*\S*(?:vault|openbao)\S*/.test(d)
      || /app\.kubernetes\.io\/name:\s*(?:vault|openbao)\b/.test(d));
  assert.deepEqual(secretStoreWorkloads, [], 'no secret-store server workload may render on the kind profile (cert-manager absent)');
  assert.doesNotMatch(out, /cert-manager\.io\/v1/, 'the kind profile must not render any cert-manager resource');
  // The default render must reference neither secret-store image (secret store is opt-in/off here).
  assert.doesNotMatch(out, /hashicorp\/vault/, 'the default kind render must not reference the hashicorp/vault image');
  assert.doesNotMatch(out, /openbao\/openbao/, 'the default kind render must not reference the openbao/openbao image (secret store off by default)');
});

// -------------------------------------------------------------------------
// (c) Widened Prometheus scrape config
// -------------------------------------------------------------------------
test('bbx-562-prom-01: scrape config still covers control-plane, cp-executor, apisix', SKIP, () => {
  // Executor is gated; enable it so its static job renders, then assert all three.
  const yml = renderedPrometheusYml(helmTemplate(['--set', 'controlPlaneExecutor.enabled=true']));
  assert.match(yml, /job_name:\s*falcone-control-plane/, 'control-plane scrape job must remain');
  assert.match(yml, /job_name:\s*falcone-cp-executor/, 'cp-executor scrape job must remain');
  assert.match(yml, /job_name:\s*falcone-apisix/, 'apisix scrape job must remain');
});

test('bbx-562-prom-02: a kubernetes pod-discovery job widens coverage beyond the 3 static targets', SKIP, () => {
  const yml = renderedPrometheusYml(helmTemplate());
  assert.match(yml, /kubernetes_sd_configs/, 'must add a kubernetes service-discovery scrape job');
  assert.match(yml, /role:\s*pod/, 'pod-role discovery covers any metrics-exposing Falcone pod');
  // The discovery job keys on the prometheus.io/scrape annotation so only annotated pods are scraped.
  assert.match(yml, /__meta_kubernetes_pod_annotation_prometheus_io_scrape/, 'discovery must filter on the prometheus.io/scrape annotation');
  // Discovery must be scoped to a single namespace (the release namespace) — no cross-namespace scraping.
  const sd = /kubernetes_sd_configs:[\s\S]*?relabel_configs:/.exec(yml)?.[0] ?? '';
  assert.match(sd, /namespaces:\s*\n\s*names:\s*\n\s*-\s*\S+/, 'pod discovery must be scoped to the release namespace');
  const nsNames = (sd.match(/names:\s*\n((?:\s*-\s*\S+\s*\n?)+)/)?.[1] ?? '').trim().split('\n').filter(Boolean);
  assert.equal(nsNames.length, 1, `pod discovery must list exactly one namespace, got ${nsNames.length}`);
});

test('bbx-562-prom-03: the metrics-exposing components carry the prometheus.io/scrape annotation', SKIP, () => {
  const out = helmTemplate(['--set', 'controlPlaneExecutor.enabled=true']);
  const wantsScrape = (componentId) => docsOfKind(out, 'Deployment')
    .filter((d) => new RegExp(`app\\.kubernetes\\.io/name:\\s*${componentId}\\b`).test(d))
    .some((d) => /prometheus\.io\/scrape:\s*"?true"?/.test(d) && /prometheus\.io\/port:/.test(d));
  assert.ok(wantsScrape('control-plane'), 'the control-plane pod must be annotated prometheus.io/scrape=true');
  assert.ok(wantsScrape('control-plane-executor'), 'the cp-executor pod must be annotated prometheus.io/scrape=true');
});

test('bbx-562-prom-04: workflow-worker (no /metrics) is NOT annotated for scraping', SKIP, () => {
  const out = helmTemplate(['--set', 'workflowWorker.enabled=true']);
  const worker = docsOfKind(out, 'Deployment').find((d) => /app\.kubernetes\.io\/name:\s*workflow-worker\b/.test(d));
  if (!worker) return; // worker disabled in this render → nothing to assert
  assert.doesNotMatch(worker, /prometheus\.io\/scrape:\s*"?true"?/,
    'workflow-worker exposes only /livez+/readyz (no /metrics) — it must NOT be scrape-annotated');
});
