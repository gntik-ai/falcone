/**
 * Black-box regression suite for the kind secret-store provisioning path
 * (spec change fix-vault-secrets-backend-on-kind, finding C.6 / D7; backend switched
 * Vault -> OpenBao in replace-vault-with-openbao).
 *
 * Drives the PUBLIC chart surface ONLY via `helm template`, inspecting the rendered OpenBao TLS
 * resources, the self-signed bootstrap Job, the OpenBao image/StatefulSet, and the ESO
 * ClusterSecretStore / ExternalSecrets.
 *
 * Defect (original): enabling the secret store aborted the release on a kind cluster — the server
 * TLS was a `cert-manager.io/v1 Certificate`, but cert-manager (and its CRDs) are absent on kind, so
 * the resource could not be created. There was no cert-manager-free path.
 *
 * Fix: `openbao.tls.mode` selects the provisioning path. `cert-manager` (default) keeps the
 * Certificate; `self-signed` instead renders a pre-install hook Job that generates the
 * openbao-server-tls Secret with openssl — no cert-manager required. The ESO openbao-backend
 * ClusterSecretStore + platform ExternalSecrets then resolve app secrets FROM OpenBao, trusting the
 * bootstrapped CA (ESO caProvider reads openbao-server-tls/ca.crt).
 *
 * The secret store is OpenBao (image openbao/openbao), provisioned by an init Job that uses the
 * `bao` CLI; no rendered object references the hashicorp/vault image.
 *
 * Self-skips when `helm` is absent (repo precedent: pgvector/temporal-helm).
 *
 * Scenario coverage (capability: deployment / secrets):
 *   bbx-c6-01  default mode is self-signed and renders the bootstrap Job, not cert-manager
 *   bbx-c6-02  self-signed mode renders NO cert-manager Certificate + a pre-install bootstrap Job
 *   bbx-c6-03  OpenBao+ESO render the openbao-backend ClusterSecretStore + ≥1 ExternalSecret (e2e)
 *   bbx-c6-04  the kind overlay enables the self-signed path and the bootstrap script is valid bash
 *   bbx-c6-05  the opt-in render uses the openbao/openbao image (bao init Job) and zero hashicorp/vault
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
const KIND_VAULT_OVERLAY = resolve(REPO_ROOT, 'deploy', 'kind', 'values-kind-vault.yaml');

function helmAvailable() {
  return spawnSync('helm', ['version', '--short'], { encoding: 'utf8' }).status === 0;
}
const SKIP = helmAvailable() ? false : { skip: 'helm binary not available on PATH' };

function helmTemplate(extraArgs = []) {
  const r = spawnSync('helm', ['template', 'falcone', CHART_PATH, ...extraArgs], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  return r.stdout;
}

function splitDocs(stream) {
  return String(stream || '')
    .split(/^---\s*$/m)
    .map((d) => d.trim())
    .filter((d) => d.length > 0 && /(^|\n)kind:\s*\S/.test(d));
}
function docsOfKind(stream, kind) {
  return splitDocs(stream).filter((d) => new RegExp(`(^|\\n)kind:\\s*${kind}\\b`).test(d));
}

function bashSyntaxOk(script) {
  const f = resolve(tmpdir(), `c6-bbx-${process.pid}-${Math.floor(performance.now())}.sh`);
  try {
    writeFileSync(f, script);
    return spawnSync('bash', ['-n', f], { encoding: 'utf8' });
  } finally {
    rmSync(f, { force: true });
  }
}

const VAULT_ON = [];
const SELF_SIGNED = [...VAULT_ON, '--set', 'openbao.openbao.tls.mode=self-signed'];

// -------------------------------------------------------------------------
// bbx-c6-01: default fresh installs do not require cert-manager
// -------------------------------------------------------------------------
test('bbx-c6-01: default mode renders self-signed bootstrap and no cert-manager Certificate', SKIP, () => {
  const out = helmTemplate(VAULT_ON);
  assert.doesNotMatch(out, /cert-manager\.io\/v1/, 'default core install must not require cert-manager CRDs');
  const job = docsOfKind(out, 'Job').find((d) => /name:\s*openbao-tls-bootstrap/.test(d));
  assert.ok(job, 'default mode must render the openbao-tls-bootstrap Job');
});

// -------------------------------------------------------------------------
// bbx-c6-02: the self-signed path drops cert-manager and adds the bootstrap Job
// -------------------------------------------------------------------------
test('bbx-c6-02: self-signed mode renders no cert-manager Certificate + a pre-install bootstrap Job', SKIP, () => {
  const out = helmTemplate(SELF_SIGNED);
  assert.doesNotMatch(out, /cert-manager\.io\/v1/, 'self-signed mode must render NO cert-manager resource (else it aborts on kind)');
  const job = docsOfKind(out, 'Job').find((d) => /name:\s*openbao-tls-bootstrap/.test(d));
  assert.ok(job, 'self-signed mode must render the openbao-tls-bootstrap Job');
  assert.match(job, /helm\.sh\/hook"?:\s*pre-install,pre-upgrade/, 'bootstrap must be a pre-install hook (cert exists before the OpenBao pod)');
  assert.match(job, /openssl req -x509/, 'bootstrap must generate a self-signed cert with openssl');
  assert.match(job, /create secret generic "\$SECRET"/, 'bootstrap must write the OpenBao TLS Secret');
  assert.match(job, /from-file=ca\.crt=/, 'the Secret must carry ca.crt so ESO can trust OpenBao');
  // The self-signed cert SANs MUST track the renamed openbao Service DNS (else ESO/CP TLS fails).
  assert.match(job, /DNS:openbao\.\$\{NS\}\.svc\.cluster\.local/, 'the bootstrap SANs must cover openbao.<ns>.svc.cluster.local');
  assert.match(job, /DNS:openbao-internal\.\$\{NS\}\.svc\.cluster\.local/, 'the bootstrap SANs must cover openbao-internal.<ns>.svc.cluster.local');
});

// -------------------------------------------------------------------------
// bbx-c6-03: ESO provides the end-to-end OpenBao secret-resolution path
// -------------------------------------------------------------------------
test('bbx-c6-03: OpenBao+ESO render the openbao-backend ClusterSecretStore and ≥1 ExternalSecret', SKIP, () => {
  const out = helmTemplate(SELF_SIGNED);
  const store = docsOfKind(out, 'ClusterSecretStore').find((d) => /name:\s*openbao-backend/.test(d));
  assert.ok(store, 'must render the openbao-backend ClusterSecretStore');
  // ESO's provider TYPE stays `vault` — it is the OpenBao-compatible provider.
  assert.match(store, /provider:\s*\n\s*vault:/, 'the ClusterSecretStore must use the (OpenBao-compatible) vault provider type');
  assert.match(store, /name:\s*openbao-server-tls/, 'ESO caProvider must reference the bootstrapped openbao-server-tls Secret');
  assert.match(store, /server:\s*"?https:\/\/openbao\.secret-store\.svc\.cluster\.local:8200/, 'the store must target the openbao Service');
  const externalSecrets = docsOfKind(out, 'ExternalSecret').filter((d) => /openbao-backend/.test(d));
  assert.ok(externalSecrets.length >= 1, `at least one app secret must resolve from OpenBao (got ${externalSecrets.length})`);
});

// -------------------------------------------------------------------------
// bbx-c6-04: the shipped kind overlay enables the path and the script is valid bash
// -------------------------------------------------------------------------
test('bbx-c6-04: kind overlay selects self-signed; rendered bootstrap script is valid bash', SKIP, () => {
  const out = helmTemplate(['-f', KIND_VAULT_OVERLAY]);
  assert.doesNotMatch(out, /cert-manager\.io\/v1/, 'the kind overlay must avoid cert-manager entirely');
  const job = docsOfKind(out, 'Job').find((d) => /name:\s*openbao-tls-bootstrap/.test(d));
  assert.ok(job, 'the kind overlay must render the bootstrap Job');
  // extract the embedded shell script (the literal block after `- -ec` / `- |`) and bash -n it.
  // The block runs to the end of the container, so collect lines indented under the `- |` marker.
  const lines = job.split('\n');
  const ecIdx = lines.findIndex((l) => /^\s*- -ec\s*$/.test(l));
  assert.ok(ecIdx >= 0, 'expected a `- -ec` arg in the bootstrap Job');
  const barIdx = lines.findIndex((l, i) => i > ecIdx && /^\s*- \|\s*$/.test(l));
  assert.ok(barIdx >= 0, 'expected a `- |` literal block for the script');
  const blockIndent = lines[barIdx].search(/\S/); // indent of the `- |` marker
  const body = [];
  for (let i = barIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') { body.push(''); continue; }
    if (lines[i].search(/\S/) <= blockIndent) break; // dedent → end of the literal block
    body.push(lines[i]);
  }
  assert.ok(body.length > 3, 'expected an embedded shell script in the bootstrap Job');
  const minIndent = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)));
  const r = bashSyntaxOk(body.map((l) => l.slice(minIndent)).join('\n'));
  assert.equal(r.status, 0, `rendered bootstrap script must be valid bash.\n${r.stderr}`);
});

// -------------------------------------------------------------------------
// bbx-c6-05: the opt-in render provisions OpenBao (image + bao init Job) and zero hashicorp/vault
// -------------------------------------------------------------------------
test('bbx-c6-05: opt-in render uses the openbao/openbao image + bao init Job, never hashicorp/vault', SKIP, () => {
  const out = helmTemplate(['-f', KIND_VAULT_OVERLAY]);
  // No HashiCorp Vault image may appear anywhere in the rendered chart.
  assert.doesNotMatch(out, /hashicorp\/vault/, 'no rendered object may reference the hashicorp/vault image');
  // The secret-store StatefulSet runs the OpenBao image.
  const sts = docsOfKind(out, 'StatefulSet').find((d) => /app\.kubernetes\.io\/name:\s*openbao\b/.test(d));
  assert.ok(sts, 'an OpenBao StatefulSet must render');
  assert.match(sts, /image:\s*"?openbao\/openbao:/, 'the StatefulSet must use the openbao/openbao image');
  assert.match(sts, /-config=\/openbao\/config\/openbao\.hcl/, 'the server must read /openbao/config/openbao.hcl');
  // The init Job bootstraps via the `bao` CLI (init/unseal, kv-v2, k8s auth, seed platform paths).
  const initJob = docsOfKind(out, 'Job').find((d) => /name:\s*openbao-init\b/.test(d));
  assert.ok(initJob, 'an openbao-init Job must render');
  assert.match(initJob, /image:\s*"?openbao\/openbao:/, 'the init Job must use the openbao/openbao image');
  assert.match(initJob, /bao operator init/, 'the init Job must initialize OpenBao with the bao CLI');
  assert.match(initJob, /bao secrets enable -path=secret kv-v2/, 'the init Job must enable the KV v2 mount');
  assert.match(initJob, /bao auth enable kubernetes/, 'the init Job must enable Kubernetes auth');
  assert.match(initJob, /kv_merge secret\/platform\/postgresql/, 'the init Job must seed the platform secret paths through the non-clobbering KV merge helper');
  assert.doesNotMatch(initJob, /(^|[^a-z])vault (operator|secrets|auth|kv|policy|audit) /, 'the init Job must use the bao CLI, not vault');
});
