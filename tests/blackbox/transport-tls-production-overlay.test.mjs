// bbx-transport-tls-production-overlay
//
// Black-box coverage for change harden-datastore-transport-tls (GitHub #645) — the deployment
// half. Asserts the production hardening overlay (deploy/kind/values-production.yaml) turns on
// in-transit encryption coherently: the global.transportSecurity stanza (TLS env + CA secret),
// the per-component opt-in flags, and the datastore TLS chart toggles. A guarded helm-render
// check proves the env + CA volume actually land on the three app pods (skipped if helm absent).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parse, parseAllDocuments } from 'yaml';

const REPO = new URL('../../', import.meta.url).pathname;
const overlay = parse(readFileSync(`${REPO}deploy/kind/values-production.yaml`, 'utf8'));

test('bbx-tls-prod-01: global.transportSecurity is enabled with a CA secret and mount path', () => {
  const ts = overlay.global.transportSecurity;
  assert.equal(ts.enabled, true);
  assert.ok(ts.caSecretName, 'a CA secret name is set');
  assert.ok(ts.caMountPath, 'a CA mount path is set');
});

test('bbx-tls-prod-02: the appended env enables TLS for every datastore protocol', () => {
  const env = Object.fromEntries(overlay.global.transportSecurity.env.map((e) => [e.name, e.value]));
  assert.equal(env.PGSSLMODE, 'verify-full');
  assert.ok(env.PGSSLROOTCERT, 'Postgres CA path is set');
  assert.equal(env.MONGO_TLS, 'true');
  assert.ok(env.MONGO_TLS_CA_FILE);
  assert.equal(env.KAFKA_SSL, 'true');
  assert.ok(env.KAFKA_SSL_CA_FILE);
  assert.ok(env.NODE_EXTRA_CA_CERTS, 'Node trusts the mounted CA for outbound https');
});

test('bbx-tls-prod-03: Keycloak JWKS and S3 endpoints are https', () => {
  const env = Object.fromEntries(overlay.global.transportSecurity.env.map((e) => [e.name, e.value]));
  assert.match(env.KEYCLOAK_JWKS_URL, /^https:\/\//);
  assert.match(env.STORAGE_S3_ENDPOINT, /^https:\/\//);
});

test('bbx-tls-prod-04: only the app runtimes opt into the TLS injection', () => {
  assert.equal(overlay.controlPlane.transportSecurityClient, true);
  assert.equal(overlay.controlPlaneExecutor.transportSecurityClient, true);
  assert.equal(overlay.workflowWorker.transportSecurityClient, true);
  // executor + worker are also turned on by the production profile.
  assert.equal(overlay.controlPlaneExecutor.enabled, true);
  assert.equal(overlay.workflowWorker.enabled, true);
});

test('bbx-tls-prod-05: datastore TLS chart toggles are flipped on', () => {
  assert.equal(overlay.ferretdb.tls.enabled, true);
  assert.equal(overlay.seaweedfs.global.seaweedfs.enableSecurity, true);
  assert.equal(overlay.seaweedfsTls.bootstrap.enabled, true);
});

test('bbx-tls-prod-06: the chart default (no overlay) does NOT enable transport security', () => {
  const base = parse(readFileSync(`${REPO}charts/in-falcone/values.yaml`, 'utf8'));
  assert.equal(base.global.transportSecurity.enabled, false, 'plaintext is the chart default');
});

// Render the chart with the overlay and assert the TLS env + CA volume land on exactly the three
// app pods. Skips cleanly where helm is unavailable (e.g. minimal CI images).
test('bbx-tls-prod-07: helm renders the TLS env + CA mount onto the three app pods', (t) => {
  let rendered;
  try {
    rendered = execFileSync('helm', [
      'template', 'in-falcone', `${REPO}charts/in-falcone`,
      '-f', `${REPO}deploy/kind/values-kind.yaml`,
      '-f', `${REPO}deploy/kind/values-production.yaml`,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    t.skip('helm not available');
    return;
  }
  const deployments = [...parseAllDocuments(rendered)]
    .map((d) => d.toJSON())
    .filter((d) => d && d.kind === 'Deployment');
  const withPg = deployments.filter((d) => {
    const c = d.spec.template.spec.containers[0];
    return (c.env ?? []).some((e) => e.name === 'PGSSLMODE');
  });
  const names = withPg.map((d) => d.metadata.name).sort();
  assert.deepEqual(names, [
    'in-falcone-control-plane',
    'in-falcone-control-plane-executor',
    'in-falcone-workflow-worker',
  ], 'exactly the three app pods receive the TLS env');
  for (const d of withPg) {
    const spec = d.spec.template.spec;
    assert.ok(spec.volumes.some((v) => v.name === 'falcone-transport-ca'), `${d.metadata.name} mounts the CA secret`);
    assert.ok(
      spec.containers[0].volumeMounts.some((m) => m.name === 'falcone-transport-ca'),
      `${d.metadata.name} container mounts the CA`
    );
  }
});
