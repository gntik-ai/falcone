/**
 * Black-box regression suite for OpenSpec change fix-vault-secrets-backend-on-kind
 * (live E2E campaign 2026-06-17, finding C.6 / D7).
 *
 * Drives the PUBLIC chart surface ONLY via `helm template`, inspecting the rendered Vault TLS
 * resources, the self-signed bootstrap Job, and the ESO ClusterSecretStore / ExternalSecrets.
 *
 * Defect: enabling Vault aborted the release on a kind cluster — the server TLS was a
 * `cert-manager.io/v1 Certificate`, but cert-manager (and its CRDs) are absent on kind, so the
 * resource could not be created. There was no cert-manager-free path.
 *
 * Fix: `vault.tls.mode` selects the provisioning path. `cert-manager` (default) keeps the
 * Certificate; `self-signed` instead renders a pre-install hook Job that generates the
 * vault-server-tls Secret with openssl — no cert-manager required. The ESO vault-backend
 * ClusterSecretStore + platform ExternalSecrets (already present) then resolve app secrets FROM
 * Vault, trusting the bootstrapped CA (ESO caProvider reads vault-server-tls/ca.crt).
 *
 * (Verified the rendered bootstrap against real openssl: the self-signed cert carries the Vault
 * Service SANs and -checkhost matches vault.secret-store.svc.cluster.local.)
 *
 * Self-skips when `helm` is absent (repo precedent: pgvector/temporal-helm).
 *
 * Scenario coverage (capability: tenant-provisioning / spec.md):
 *   bbx-c6-01  default (cert-manager) mode still renders the cert-manager Certificate (no bootstrap)
 *   bbx-c6-02  self-signed mode renders NO cert-manager Certificate + a pre-install bootstrap Job
 *   bbx-c6-03  Vault+ESO render the vault-backend ClusterSecretStore + ≥1 ExternalSecret (end-to-end)
 *   bbx-c6-04  the kind overlay enables the self-signed path and the bootstrap script is valid bash
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

const VAULT_ON = ['--set', 'vault.enabled=true', '--set', 'eso.enabled=true'];
const SELF_SIGNED = [...VAULT_ON, '--set', 'vault.vault.tls.mode=self-signed'];

// -------------------------------------------------------------------------
// bbx-c6-01: the cert-manager path is preserved by default
// -------------------------------------------------------------------------
test('bbx-c6-01: default mode renders the cert-manager Certificate and no bootstrap Job', SKIP, () => {
  const out = helmTemplate(VAULT_ON);
  const certs = docsOfKind(out, 'Certificate').filter((d) => /cert-manager\.io\/v1/.test(d) && /vault-server-tls/.test(d));
  assert.equal(certs.length, 1, 'cert-manager mode must still render the vault-server-tls Certificate');
  assert.doesNotMatch(out, /name:\s*vault-tls-bootstrap/, 'the self-signed bootstrap must NOT render in cert-manager mode');
});

// -------------------------------------------------------------------------
// bbx-c6-02: the self-signed path drops cert-manager and adds the bootstrap Job
// -------------------------------------------------------------------------
test('bbx-c6-02: self-signed mode renders no cert-manager Certificate + a pre-install bootstrap Job', SKIP, () => {
  const out = helmTemplate(SELF_SIGNED);
  assert.doesNotMatch(out, /cert-manager\.io\/v1/, 'self-signed mode must render NO cert-manager resource (else it aborts on kind)');
  const job = docsOfKind(out, 'Job').find((d) => /name:\s*vault-tls-bootstrap/.test(d));
  assert.ok(job, 'self-signed mode must render the vault-tls-bootstrap Job');
  assert.match(job, /helm\.sh\/hook"?:\s*pre-install,pre-upgrade/, 'bootstrap must be a pre-install hook (cert exists before the Vault pod)');
  assert.match(job, /openssl req -x509/, 'bootstrap must generate a self-signed cert with openssl');
  assert.match(job, /create secret generic "\$SECRET"/, 'bootstrap must write the vault TLS Secret');
  assert.match(job, /from-file=ca\.crt=/, 'the Secret must carry ca.crt so ESO can trust Vault');
});

// -------------------------------------------------------------------------
// bbx-c6-03: ESO provides the end-to-end Vault secret-resolution path
// -------------------------------------------------------------------------
test('bbx-c6-03: Vault+ESO render the vault-backend ClusterSecretStore and ≥1 ExternalSecret', SKIP, () => {
  const out = helmTemplate(SELF_SIGNED);
  const store = docsOfKind(out, 'ClusterSecretStore').find((d) => /name:\s*vault-backend/.test(d));
  assert.ok(store, 'must render the vault-backend ClusterSecretStore');
  assert.match(store, /provider:\s*\n\s*vault:/, 'the ClusterSecretStore must use the Vault provider');
  assert.match(store, /name:\s*vault-server-tls/, 'ESO caProvider must reference the bootstrapped vault-server-tls Secret');
  const externalSecrets = docsOfKind(out, 'ExternalSecret').filter((d) => /vault-backend/.test(d));
  assert.ok(externalSecrets.length >= 1, `at least one app secret must resolve from Vault (got ${externalSecrets.length})`);
});

// -------------------------------------------------------------------------
// bbx-c6-04: the shipped kind overlay enables the path and the script is valid bash
// -------------------------------------------------------------------------
test('bbx-c6-04: kind overlay selects self-signed; rendered bootstrap script is valid bash', SKIP, () => {
  const out = helmTemplate(['-f', KIND_VAULT_OVERLAY]);
  assert.doesNotMatch(out, /cert-manager\.io\/v1/, 'the kind overlay must avoid cert-manager entirely');
  const job = docsOfKind(out, 'Job').find((d) => /name:\s*vault-tls-bootstrap/.test(d));
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
