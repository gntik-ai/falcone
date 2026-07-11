/**
 * Static readiness coverage for make-all-services-core (#898).
 *
 * These tests exercise the install source of truth without touching a cluster:
 * Helm must render in an arbitrary release namespace, core disable switches must
 * fail closed, OpenBao/ESO credential mappings must stay aligned, Temporal must
 * bootstrap its DB role from the canonical Secret, and MCP routes/RBAC must target
 * the Helm-owned executor.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAllDocuments } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CHART_PATH = resolve(REPO_ROOT, 'charts', 'in-falcone');
const KIND_VALUES = resolve(REPO_ROOT, 'deploy', 'kind', 'values-kind.yaml');
const CUTOVER_SCRIPTS = resolve(REPO_ROOT, 'scripts', 'system-changes', 'make-all-services-core');

function helmAvailable() {
  return spawnSync('helm', ['version', '--short'], { encoding: 'utf8' }).status === 0;
}
const SKIP = helmAvailable() ? false : { skip: 'helm binary not available on PATH' };
function dockerAvailable() {
  return spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' }).status === 0;
}
const DOCKER_SKIP = dockerAvailable() ? false : { skip: 'docker daemon not available on PATH' };

function helmTemplate(args = []) {
  return spawnSync('helm', ['template', 'falcone', CHART_PATH, '--namespace', 'review-ns', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 96 * 1024 * 1024,
  });
}

function assertRender(args = []) {
  const r = helmTemplate(args);
  assert.equal(r.status, 0, `helm template must succeed.\nstderr: ${r.stderr}`);
  return r.stdout;
}
function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function renderDocs(args = []) {
  return parseAllDocuments(assertRender(args)).map((doc) => doc.toJSON()).filter(Boolean);
}
function findDoc(docs, kind, name) {
  return docs.find((doc) => doc.kind === kind && doc.metadata?.name === name);
}
function imageList(docs) {
  const images = [];
  for (const doc of docs) {
    const podSpecs = [
      doc.kind === 'Pod' ? doc.spec : null,
      doc.spec?.template?.spec,
      doc.spec?.jobTemplate?.spec?.template?.spec,
    ].filter(Boolean);
    for (const podSpec of podSpecs) {
      for (const container of [...(podSpec.initContainers ?? []), ...(podSpec.containers ?? [])]) {
        if (container.image) images.push(container.image);
      }
    }
  }
  return images;
}
function hookKinds(docs, hooks) {
  return docs.filter((doc) => {
    const hook = doc.metadata?.annotations?.['helm.sh/hook'];
    return typeof hook === 'string' && hooks.some((entry) => hook.split(',').includes(entry));
  });
}
function envValue(job, name) {
  const containers = job.spec?.template?.spec?.containers ?? [];
  for (const container of containers) {
    const env = container.env ?? [];
    const match = env.find((entry) => entry.name === name);
    if (match) return match.value;
  }
  return undefined;
}
function commandText(job) {
  return (job.spec?.template?.spec?.containers ?? [])
    .flatMap((container) => container.command ?? [])
    .join('\n');
}

test('all-core-001: arbitrary release namespace is used consistently', SKIP, () => {
  const out = assertRender();
  assert.match(out, /kind:\s*Namespace[\s\S]*name:\s*review-ns/, 'Namespace resource must use .Release.Namespace');
  assert.match(out, /namespace:\s*review-ns/, 'namespaced resources must render in the release namespace');
  assert.doesNotMatch(out, /namespace:\s*in-falcone-dev\b|name:\s*in-falcone-dev\b/, 'global.namespace must not leak into rendered manifests');
  assert.match(out, /openbao-access:\s*"true"/, 'release namespace must be labeled for OpenBao NetworkPolicy ingress');
});

test('all-core-002: legacy enabled=false switches fail for every core service alias', SKIP, () => {
  const aliases = [
    'bootstrap',
    'apisix',
    'keycloak',
    'postgresql',
    'postgresqlVector',
    'documentdb',
    'ferretdb',
    'kafka',
    'seaweedfs',
    'grafana',
    'observability',
    'controlPlane',
    'controlPlaneExecutor',
    'webConsole',
    'workflowWorker',
    'eso',
    'openbao',
    'temporal',
    'mcp',
  ];
  for (const alias of aliases) {
    const r = helmTemplate(['--set', `${alias}.enabled=false`]);
    assert.notEqual(r.status, 0, `${alias}.enabled=false must fail`);
    assert.match(r.stderr, /no longer supported|cannot be disabled/i, `${alias}.enabled=false must explain core-service optionality`);
  }
});

test('all-core-003: nested service.enabled=false fails for core service components', SKIP, () => {
  const serviceComponents = [
    'apisix',
    'keycloak',
    'postgresql',
    'postgresqlVector',
    'documentdb',
    'ferretdb',
    'kafka',
    'observability',
    'controlPlane',
    'controlPlaneExecutor',
    'webConsole',
    'workflowWorker',
  ];
  for (const component of serviceComponents) {
    const r = helmTemplate(['--set', `${component}.service.enabled=false`]);
    assert.notEqual(r.status, 0, `${component}.service.enabled=false must fail`);
    assert.match(r.stderr, /core platform service unreachable/i, `${component}.service.enabled=false must explain service reachability`);
  }
});

test('all-core-004: OpenBao seeding and ESO remoteRefs are aligned', SKIP, () => {
  const out = assertRender();
  const expected = [
    ['KAFKA_CFG_NODE_ID', 'platform/kafka', 'node-id'],
    ['KAFKA_CFG_PROCESS_ROLES', 'platform/kafka', 'KAFKA_CFG_PROCESS_ROLES'],
    ['KAFKA_CFG_CONTROLLER_LISTENER_NAMES', 'platform/kafka', 'KAFKA_CFG_CONTROLLER_LISTENER_NAMES'],
    ['KAFKA_CFG_CONTROLLER_QUORUM_VOTERS', 'platform/kafka', 'KAFKA_CFG_CONTROLLER_QUORUM_VOTERS'],
    ['KAFKA_CFG_LISTENERS', 'platform/kafka', 'KAFKA_CFG_LISTENERS'],
    ['KAFKA_CFG_ADVERTISED_LISTENERS', 'platform/kafka', 'KAFKA_CFG_ADVERTISED_LISTENERS'],
    ['KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP', 'platform/kafka', 'KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP'],
    ['password', 'platform/temporal', 'password'],
    ['realtime-url', 'platform/documentdb-replication', 'realtime-url'],
    ['master-key', 'platform/encryption', 'master-key'],
  ];
  for (const [secretKey, remoteKey, property] of expected) {
    assert.match(out, new RegExp(`secretKey:\\s*${escapeRe(secretKey)}[\\s\\S]*remoteRef:\\s*\\{\\s*key:\\s*${escapeRe(remoteKey)},\\s*property:\\s*${escapeRe(property)}\\s*\\}`), `${secretKey} must map to ${remoteKey}/${property}`);
  }
  for (const property of ['node-id', 'KAFKA_CFG_NODE_ID', 'KAFKA_CFG_PROCESS_ROLES', 'KAFKA_CFG_CONTROLLER_LISTENER_NAMES', 'KAFKA_CFG_CONTROLLER_QUORUM_VOTERS', 'KAFKA_CFG_LISTENERS', 'KAFKA_CFG_ADVERTISED_LISTENERS', 'KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP']) {
    assert.match(out, new RegExp(`${property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}="\\$\\(cred in-falcone-kafka`), `OpenBao init must seed Kafka property ${property}`);
  }
  assert.match(out, /kv_merge secret\/platform\/temporal[\s\S]*visibility-database="\$\(cred in-falcone-temporal visibility-database\)"/, 'OpenBao init must seed Temporal credentials without clobbering unmapped properties');
  assert.match(out, /kv_merge secret\/platform\/encryption[\s\S]*master-key="\$\(cred in-falcone-encryption master-key\)"/, 'OpenBao init must seed encryption key without clobbering unmapped properties');
  assert.match(out, /--from-file=root-token=\/openbao-recovery\/root-token/, 'OpenBao recovery Secret must preserve the root token for partial init convergence');
  assert.match(out, /cp \/openbao-recovery-mounted\/root-token \/openbao-recovery\/root-token[\s\S]*\[ -s \/openbao-recovery\/unseal1 \] && \[ -s \/openbao-recovery\/root-token \]/, 'initialized recovery branches must not signal .ready without a root token');
  assert.match(out, /openbao-recovery-mounted\/root-token[\s\S]*openbao-init-role login failed/, 'OpenBao init must fall back to mounted recovery root token before Kubernetes-auth login failures');
  assert.doesNotMatch(out, /randAlphaNum/, 'OpenBao init must not generate unrelated credential values');
});

test('all-core-005: Temporal DB bootstrap is wired before schema setup', SKIP, () => {
  const out = assertRender();
  const docs = renderDocs();
  const dbBootstrap = findDoc(docs, 'Job', 'falcone-temporal-db-bootstrap');
  const schema = findDoc(docs, 'Job', 'falcone-temporal-schema');
  assert.equal(dbBootstrap?.metadata?.annotations?.['helm.sh/hook'], undefined, 'fresh-install DB bootstrap must be a normal Job because PostgreSQL belongs to the same release');
  assert.equal(schema?.metadata?.annotations?.['helm.sh/hook'], undefined, 'fresh-install schema setup must be a normal Job because PostgreSQL belongs to the same release');
  assert.match(out, /CREATE ROLE %I LOGIN CREATEDB PASSWORD %L/, 'Temporal bootstrap must create the role idempotently');
  assert.match(out, /name:\s*"in-falcone-temporal"[\s\S]*key:\s*"password"/, 'Temporal schema/bootstrap must use the generated Temporal Secret');
  assert.match(out, /SQL_USER[\s\S]*value:\s*"temporal"[\s\S]*SQL_PASSWORD[\s\S]*secretKeyRef:/, 'Temporal schema job must use the same role and Secret');
});

test('all-core-006: Helm owns the /v1/mcp route, executor RBAC, and pullable default image refs', SKIP, () => {
  const base = assertRender();
  const baseImages = imageList(parseAllDocuments(base).map((doc) => doc.toJSON()).filter(Boolean));
  assert.match(base, /route-2018-mcp\.json:[\s\S]*"uri": "\/v1\/mcp\/\*"/, 'bootstrap payload must include the MCP APISIX route');
  assert.match(base, /falcone-control-plane-executor\.review-ns\.svc\.cluster\.local:8080/, 'MCP route must target the Helm-owned executor service');
  assert.match(base, /kind:\s*RoleBinding[\s\S]*name:\s*falcone-mcp-runtime[\s\S]*namespace:\s*review-ns[\s\S]*kind:\s*ServiceAccount[\s\S]*name:\s*falcone-control-plane-executor[\s\S]*namespace:\s*review-ns/, 'MCP RBAC must bind the executor service account in the release namespace');
  assert.doesNotMatch(base, /ghcr\.io\/example/, 'fresh install values must not use example image repositories');
  assert.doesNotMatch(base, /localhost:30500\/in-falcone-/, 'fresh install base values must not render localhost-only project images');
  assert.doesNotMatch(base, /image:\s*['"]?docker\.io\/bitnami\/(postgresql:17\.2\.0|kafka:3\.9\.0|kubectl:1\.32\.2)/, 'fresh install must not render removed bitnami image tags');
  const removedKubectlImage = ['docker.io', 'bitnamilegacy', 'kubectl:1.32.2'].join('/');
  assert.equal(baseImages.includes(removedKubectlImage), false, 'bootstrap jobs must not use kubectl-only images without bash/curl/jq');
  assert.doesNotMatch(base, /image:\s*"docker\.io\/apache\/apisix:3\.10\.0"/, 'fresh install must not render the missing APISIX tag');
  assert.doesNotMatch(base, /image:\s*"docker\.io\/prom\/prometheus:3\.2\.1"/, 'fresh install must not render the missing Prometheus tag');
  assert.match(base, /image:\s*"docker\.io\/apache\/apisix:3\.10\.0-debian"/, 'APISIX must use the verified pullable Debian tag');
  assert.match(base, /image:\s*"docker\.io\/prom\/prometheus@sha256:6927e0919a144aa7616fd0137d4816816d42f6b816de3af269ab065250859a62"/, 'Prometheus must use the verified v3.2.1 manifest digest');
  assert.match(base, /image:\s*"docker\.io\/bitnamilegacy\/postgresql:17\.2\.0"/, 'PostgreSQL must use the verified bitnamilegacy image');
  assert.match(base, /image:\s*"docker\.io\/bitnamilegacy\/kafka:3\.9\.0"/, 'Kafka must use the verified bitnamilegacy image');
  assert.ok(baseImages.includes('docker.io/alpine/k8s:1.32.2'), 'bootstrap jobs must use the verified alpine/k8s image with bash, curl, jq, and kubectl');
  const releaseTag = '0.3.0';
  for (const image of [
    'in-falcone-control-plane',
    'in-falcone-control-plane-executor',
    'in-falcone-workflow-worker',
    'in-falcone-web-console',
  ]) {
    assert.match(base, new RegExp(`image:\\s*"ghcr\\.io/gntik-ai/${image}:${escapeRe(releaseTag)}"`), `${image} must use the chart app release tag`);
  }
  assert.match(base, /name:\s*in-falcone-runtime-env[\s\S]*MCP_RUNTIME_IMAGE:\s*"ghcr\.io\/gntik-ai\/in-falcone-mcp-runtime:0\.3\.0"/, 'default MCP runtime env must use the chart app release tag from the runtime env ConfigMap');
  assert.match(base, /name:\s*falcone-control-plane[\s\S]*envFrom:[\s\S]*name:\s*in-falcone-runtime-env/, 'control-plane must consume the parent-rendered runtime env ConfigMap');
  assert.match(base, /name:\s*falcone-control-plane-executor[\s\S]*envFrom:[\s\S]*name:\s*in-falcone-runtime-env/, 'executor must consume the parent-rendered runtime env ConfigMap');
  assert.doesNotMatch(base, /ghcr\.io\/gntik-ai\/in-falcone-[^:\s"]+:(0\.1\.0|0\.2\.11|0\.6\.2|0\.9\.3)/, 'first-party defaults must not mix stale component tags');
  const valuesYaml = readFileSync(resolve(CHART_PATH, 'values.yaml'), 'utf8');
  assert.match(valuesYaml, /mcp:\n[\s\S]*runtimeImage:\n[\s\S]*repository:\s*ghcr\.io\/gntik-ai\/in-falcone-mcp-runtime\n[\s\S]*tag:\s*0\.3\.0/, 'mcp.runtimeImage values must use the chart app release tag');

  const kind = assertRender(['-f', KIND_VALUES]);
  assert.match(kind, /image:\s*"localhost:30500\/in-falcone-control-plane-executor:0\.9\.3"/, 'kind overlay must use the local executor image');
  assert.match(kind, /image:\s*"localhost:30500\/in-falcone-workflow-worker:0\.1\.0"/, 'kind overlay must use the local workflow-worker image');
  assert.match(kind, /image:\s*"localhost:30500\/in-falcone-web-console:0\.2\.11"/, 'kind overlay must use the local web-console image');
  assert.match(kind, /MCP_RUNTIME_IMAGE:\s*"localhost:30500\/in-falcone-mcp-runtime"/, 'kind overlay must use the local MCP runtime image via mcp.runtimeImage');
  assert.doesNotMatch(kind, /MCP_RUNTIME_IMAGE_DIGEST/, 'kind overlay must not carry an unverified MCP runtime digest');

  const releaseWorkflow = readFileSync(resolve(REPO_ROOT, '.github', 'workflows', 'release-images.yml'), 'utf8');
  const mcpDockerfile = readFileSync(resolve(REPO_ROOT, 'apps', 'mcp-runtime', 'Dockerfile'), 'utf8');
  assert.match(releaseWorkflow, /image:\s*in-falcone-mcp-runtime[\s\S]*dockerfile:\s*apps\/mcp-runtime\/Dockerfile/, 'release workflow must publish the MCP runtime image');
  assert.match(mcpDockerfile, /COPY apps\/control-plane\/src\/mcp-official-server\.mjs/, 'MCP runtime image must build from the production MCP server modules');
});

test('all-core-006c: bootstrap image contains required command-line tools', DOCKER_SKIP, () => {
  const r = spawnSync('docker', [
    'run',
    '--rm',
    '--entrypoint',
    '/bin/sh',
    'docker.io/alpine/k8s:1.32.2',
    '-ec',
    'for c in bash curl jq kubectl; do command -v "$c" >/dev/null || exit 1; done',
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(r.status, 0, `alpine/k8s bootstrap image must contain bash, curl, jq, and kubectl.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
});

test('all-core-007: ESO operator, webhook, cert-controller, CRDs, and auxiliary namespaces render', SKIP, () => {
  const vendoredChart = readFileSync(resolve(CHART_PATH, 'charts', 'eso', 'charts', 'external-secrets', 'Chart.yaml'), 'utf8');
  const nestedLock = readFileSync(resolve(CHART_PATH, 'charts', 'eso', 'Chart.lock'), 'utf8');
  const vendoring = readFileSync(resolve(CHART_PATH, 'charts', 'eso', 'VENDORING.md'), 'utf8');
  assert.match(vendoredChart, /name:\s*external-secrets/, 'ESO wrapper must vendor the upstream external-secrets chart');
  assert.match(vendoredChart, /version:\s*0\.9\.0/, 'vendored external-secrets chart version must match the wrapper dependency pin');
  assert.match(nestedLock, /name:\s*external-secrets[\s\S]*version:\s*0\.9\.0/, 'ESO wrapper must carry a nested lock for the vendored upstream chart');
  assert.match(vendoring, /unpacked chart/, 'ESO wrapper must document that the unpacked chart is intentionally tracked');
  const docs = renderDocs();
  assert.ok(findDoc(docs, 'Namespace', 'review-ns'), 'release namespace must render for a fresh install');
  assert.ok(findDoc(docs, 'Namespace', 'eso-system'), 'ESO auth namespace must render for a fresh install');
  assert.ok(findDoc(docs, 'Namespace', 'secret-store'), 'OpenBao namespace must render for a fresh install');
  assert.equal(findDoc(docs, 'Deployment', 'eso-external-secrets')?.metadata?.namespace, 'eso-system', 'ESO controller Deployment must run in the configured ESO namespace');
  assert.equal(findDoc(docs, 'Deployment', 'eso-external-secrets-webhook')?.metadata?.namespace, 'eso-system', 'ESO admission webhook Deployment must run in the configured ESO namespace');
  assert.equal(findDoc(docs, 'Deployment', 'eso-external-secrets-cert-controller')?.metadata?.namespace, 'eso-system', 'ESO cert-controller Deployment must run in the configured ESO namespace');
  assert.ok(findDoc(docs, 'CustomResourceDefinition', 'externalsecrets.external-secrets.io'), 'ExternalSecret CRD must render from the vendored dependency');
  assert.ok(findDoc(docs, 'CustomResourceDefinition', 'clustersecretstores.external-secrets.io'), 'ClusterSecretStore CRD must render from the vendored dependency');
  const out = assertRender();
  assert.doesNotMatch(out, /eso-crd-extract-external-secrets-webhook/, 'stale extracted CRD webhook names must not render');
  assert.doesNotMatch(out, /namespace:\s*default\b/, 'CRD conversion webhooks must not point at the default namespace');
  assert.match(out, /kubectl -n eso-system get endpoints eso-external-secrets-webhook/, 'webhook wait Job must wait in the namespace where the webhook Service runs');
});

test('all-core-006b: MCP runtime image and digest render from one chart value block', SKIP, () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  const out = assertRender([
    '--set', 'mcp.runtimeImage.repository=ghcr.io/example/mcp-runtime',
    '--set', 'mcp.runtimeImage.tag=1.2.3',
    '--set', `mcp.runtimeImage.digest=${digest}`,
  ]);
  assert.match(out, /name:\s*in-falcone-runtime-env[\s\S]*MCP_RUNTIME_IMAGE:\s*"ghcr\.io\/example\/mcp-runtime:1\.2\.3"/, 'MCP runtime image must render from mcp.runtimeImage.repository/tag');
  assert.match(out, new RegExp(`MCP_RUNTIME_IMAGE_DIGEST:\\s*"${escapeRe(digest)}"`), 'MCP runtime digest must render from mcp.runtimeImage.digest');
  assert.doesNotMatch(out, /value:\s*ghcr\.io\/gntik-ai\/in-falcone-mcp-runtime:0\.3\.0/, 'control-plane/executor env must not hard-code MCP_RUNTIME_IMAGE outside the runtime env ConfigMap');
});

test('all-core-008: ESO cluster-scoped ownership preflight renders', SKIP, () => {
  const out = assertRender();
  const docs = parseAllDocuments(out).map((doc) => doc.toJSON()).filter(Boolean);
  const esoPreflight = findDoc(docs, 'Job', 'eso-preflight');
  assert.match(out, /kind:\s*Job[\s\S]*name:\s*eso-preflight/, 'ESO ownership preflight Job must render');
  assert.match(out, /resources:\s*\["clustersecretstores"\]/, 'preflight must inspect ClusterSecretStore ownership');
  assert.match(out, /resources:\s*\["deployments"\]/, 'preflight must inspect cluster ESO deployments');
  assert.match(out, /adoptExisting/, 'preflight must expose the explicit adoptExisting override');
  assert.match(commandText(esoPreflight), /namespace="review-ns"[\s\S]*\$\{namespace\}\/\*\) ;;/, 'preflight must allow the release-owned ESO operator deployment');
  assert.match(out, /set eso\.eso\.clusterOwnership\.adoptExisting=true/, 'preflight must fail closed on unowned cluster-scoped stores');
});

test('all-core-009: OpenBao, ESO, and runtime env honor custom secret namespaces', SKIP, () => {
  const out = assertRender([
    '--set', 'eso.eso.namespace=custom-eso',
    '--set', 'eso.external-secrets.namespaceOverride=custom-eso',
    '--set', 'openbao.eso.namespace=custom-eso',
    '--set', 'openbao.openbao.namespace=custom-store',
    '--set', 'eso.eso.caProvider.namespace=custom-store',
  ]);
  const docs = parseAllDocuments(out).map((doc) => doc.toJSON()).filter(Boolean);
  assert.match(out, /name:\s*eso-openbao-auth[\s\S]*namespace:\s*custom-eso/, 'OpenBao must render ESO auth ServiceAccount in the configured ESO namespace');
  assert.match(out, /bound_service_account_namespaces='custom-eso'/, 'OpenBao Kubernetes auth role for ESO must bind the configured ESO namespace');
  assert.match(out, /BAO_ADDR:\s*"https:\/\/openbao\.custom-store\.svc\.cluster\.local:8200"/, 'runtime env must point workloads at the configured OpenBao namespace');
  assert.match(out, /api_addr\s*=\s*"https:\/\/openbao\.custom-store\.svc\.cluster\.local:8200"/, 'OpenBao api_addr must use the configured OpenBao namespace');
  assert.match(out, /cluster_addr\s*=\s*"https:\/\/\$\(HOSTNAME\)\.openbao-internal\.custom-store\.svc\.cluster\.local:8201"/, 'OpenBao cluster_addr must use the configured OpenBao namespace');
  assert.match(out, /server:\s*"https:\/\/openbao\.custom-store\.svc\.cluster\.local:8200"/, 'ESO ClusterSecretStore must use the configured OpenBao namespace');
  assert.match(out, /kubernetes\.io\/metadata\.name:\s*custom-eso/, 'OpenBao NetworkPolicy must allow the configured ESO namespace');
  assert.match(out, /kubernetes\.io\/metadata\.name:\s*"custom-store"/, 'ESO NetworkPolicy must allow egress to the configured OpenBao namespace');
  assert.equal(findDoc(docs, 'Deployment', 'eso-external-secrets')?.metadata?.namespace, 'custom-eso', 'ESO controller must run in the configured ESO namespace');
  assert.doesNotMatch(out, /bound_service_account_namespaces='eso-system'/, 'custom ESO namespace must not leave the auth role hard-coded to eso-system');
  assert.doesNotMatch(out, /https:\/\/openbao\.secret-store\.svc\.cluster\.local:8200/, 'custom OpenBao namespace must not leave workload or ESO addresses hard-coded to secret-store');
});

test('all-core-009d: pre-install hooks run in the release namespace while targeting configured auxiliary namespaces', SKIP, () => {
  const docs = renderDocs([
    '--set', 'seaweedfsTls.bootstrap.enabled=true',
    '--set', 'eso.eso.namespace=custom-eso',
    '--set', 'eso.external-secrets.namespaceOverride=custom-eso',
    '--set', 'openbao.eso.namespace=custom-eso',
    '--set', 'openbao.openbao.namespace=custom-store',
    '--set', 'eso.eso.caProvider.namespace=custom-store',
  ]);
  for (const doc of hookKinds(docs, ['pre-install', 'pre-upgrade'])) {
    if (doc.kind === 'ClusterRole' || doc.kind === 'ClusterRoleBinding') continue;
    assert.equal(doc.metadata?.namespace, 'review-ns', `${doc.kind}/${doc.metadata?.name} pre-install hook must run in the release namespace`);
  }

  const openbaoTls = findDoc(docs, 'Job', 'openbao-tls-bootstrap');
  assert.ok(openbaoTls, 'OpenBao TLS bootstrap Job must render');
  assert.equal(openbaoTls.metadata?.namespace, 'review-ns', 'OpenBao TLS bootstrap Job must run in the release namespace');
  assert.equal(envValue(openbaoTls, 'NS'), 'custom-store', 'OpenBao TLS bootstrap must still write the server cert into the configured OpenBao namespace');
  assert.equal(envValue(openbaoTls, 'CLIENT_NS'), 'review-ns', 'OpenBao client CA copy must target the release namespace');
  assert.match(commandText(openbaoTls), /ensure_namespace "\$NS"/, 'OpenBao TLS bootstrap must create/adopt the configured target namespace before writing the TLS secret');

  const esoPreflight = findDoc(docs, 'Job', 'eso-preflight');
  assert.ok(esoPreflight, 'ESO ownership preflight Job must render');
  assert.equal(esoPreflight.metadata?.namespace, 'review-ns', 'ESO preflight Job must run in the release namespace');
  assert.match(commandText(esoPreflight), /eso_namespace="custom-eso"/, 'ESO preflight must still evaluate the configured ESO operator namespace');

  const temporalDb = findDoc(docs, 'Job', 'falcone-temporal-db-bootstrap');
  const temporalSchema = findDoc(docs, 'Job', 'falcone-temporal-schema');
  assert.equal(temporalDb?.metadata?.namespace, 'review-ns', 'Temporal DB bootstrap install Job must run in the release namespace');
  assert.equal(temporalSchema?.metadata?.namespace, 'review-ns', 'Temporal schema install Job must run in the release namespace');

  const seaweedResizeHook = readFileSync(resolve(CHART_PATH, 'charts', 'seaweedfs', 'templates', 'volume', 'volume-resize-hook.yaml'), 'utf8');
  const seaweedValues = readFileSync(resolve(CHART_PATH, 'charts', 'seaweedfs', 'values.yaml'), 'utf8');
  assert.match(seaweedResizeHook, /volume-resize-hook[\s\S]*namespace: \{\{ \.Release\.Namespace \}\}/, 'SeaweedFS resize hook resources must explicitly run in the release namespace when the live-state condition renders them');
  assert.match(seaweedResizeHook, /subjects:[\s\S]*namespace: \{\{ \.Release\.Namespace \}\}/, 'SeaweedFS resize hook RoleBinding subject must use the release namespace');
  assert.match(seaweedValues, /resizeHook:[\s\S]*image: docker\.io\/alpine\/k8s:1\.32\.2/, 'SeaweedFS resize hook must use the verified alpine/k8s helper image');
});

test('all-core-009b: mismatched ESO operator namespace fails closed', SKIP, () => {
  const r = helmTemplate([
    '--set', 'eso.eso.namespace=custom-eso',
    '--set', 'openbao.eso.namespace=custom-eso',
  ]);
  assert.notEqual(r.status, 0, 'custom ESO auth namespace without matching operator namespace override must fail');
  assert.match(r.stderr, /namespaceOverride must match eso\.eso\.namespace/, 'validation must explain the protected ESO namespace contract');
});

test('all-core-009c: cert-manager OpenBao certificate SANs honor custom namespace', SKIP, () => {
  const out = assertRender([
    '--set', 'openbao.openbao.tls.mode=cert-manager',
    '--set', 'eso.eso.namespace=custom-eso',
    '--set', 'eso.external-secrets.namespaceOverride=custom-eso',
    '--set', 'openbao.eso.namespace=custom-eso',
    '--set', 'openbao.openbao.namespace=custom-store',
    '--set', 'eso.eso.caProvider.namespace=custom-store',
  ]);
  assert.match(out, /commonName:\s*openbao\.custom-store\.svc\.cluster\.local/, 'OpenBao Certificate commonName must use the configured namespace');
  assert.match(out, /dnsNames:[\s\S]*openbao\.custom-store[\s\S]*openbao\.custom-store\.svc[\s\S]*openbao\.custom-store\.svc\.cluster\.local[\s\S]*openbao-internal\.custom-store\.svc\.cluster\.local/, 'OpenBao Certificate SANs must use the configured namespace');
  assert.doesNotMatch(out, /openbao\.secret-store\.svc\.cluster\.local/, 'custom cert-manager SANs must not retain secret-store');
});

test('all-core-010: Kafka default and supported profiles are valid single-broker KRaft', SKIP, () => {
  for (const args of [
    [],
    ['-f', resolve(REPO_ROOT, 'charts', 'in-falcone', 'values', 'profiles', 'standard.yaml')],
    ['-f', resolve(REPO_ROOT, 'charts', 'in-falcone', 'values', 'profiles', 'ha.yaml')],
  ]) {
    const docs = renderDocs(args);
    const kafka = findDoc(docs, 'StatefulSet', 'falcone-kafka');
    assert.ok(kafka, 'Kafka StatefulSet must render');
    assert.equal(kafka.spec?.replicas, 1, `Kafka must default to one broker for args ${args.join(' ') || '(base)'}`);
  }
  const out = assertRender();
  assert.match(out, /name:\s*in-falcone-kafka[\s\S]*KAFKA_CFG_NODE_ID:\s*"0"/, 'Kafka Secret must seed node id 0 for the single broker');
  assert.match(out, /KAFKA_CFG_CONTROLLER_QUORUM_VOTERS:\s*"0@127\.0\.0\.1:9093"/, 'single-broker KRaft quorum must use node 0 only');
});

test('all-core-011: existing-install cutover scripts fail closed, merge KV data, and are release-name safe', () => {
  const common = readFileSync(resolve(CUTOVER_SCRIPTS, 'common.sh'), 'utf8');
  const backup = readFileSync(resolve(CUTOVER_SCRIPTS, 'backup-kv.sh'), 'utf8');
  const migrate = readFileSync(resolve(CUTOVER_SCRIPTS, 'migrate-platform-secrets.sh'), 'utf8');
  const restore = readFileSync(resolve(CUTOVER_SCRIPTS, 'restore-kv.sh'), 'utf8');
  const health = readFileSync(resolve(CUTOVER_SCRIPTS, 'health-check.sh'), 'utf8');
  const diff = readFileSync(resolve(CUTOVER_SCRIPTS, 'diff-rollout.sh'), 'utf8');
  const openbaoInit = readFileSync(resolve(REPO_ROOT, 'charts', 'in-falcone', 'charts', 'openbao', 'templates', 'openbao-init-job.yaml'), 'utf8');

  assert.match(backup, /helm -n "\$NS" get values "\$RELEASE" --all -o yaml/, 'backup must capture Helm values for the configured release');
  assert.match(backup, /write_secret_checksums/, 'backup must capture Kubernetes Secret fingerprints');
  assert.match(backup, /backup_source_kv_paths/, 'backup must support external Vault\/OpenBao source KV capture');
  assert.match(backup, /refusing to overwrite existing backup archive/, 'backup must refuse to overwrite an existing archive');
  assert.match(backup, /target OpenBao not supplied; recording target KV as absent/, 'backup must work before target OpenBao exists');
  assert.match(backup, /"targetKvCaptured":\$target_kv_captured/, 'backup manifest must record whether target KV was captured');

  assert.match(common, /cp "\$existing" "\$merged"/, 'KV helper must start from existing target data');
  assert.match(common, /jq --arg property "\$property" --rawfile value "\$file" '\. \+ \{\(\$property\): \$value\}'/, 'KV helper must overlay mapped properties without dropping unmapped ones');
  assert.match(common, /merge_kv_backup_json/, 'common helpers must support merging backed-up external source KV');
  assert.match(openbaoInit, /kv_merge\(\)[\s\S]*bao kv get "\$path"[\s\S]*bao kv patch "\$path"[\s\S]*bao kv put "\$path"/, 'OpenBao init must patch existing KV paths and only put on first creation');

  assert.match(migrate, /--apply requires --backup/, 'migration apply must require a verified backup');
  assert.match(common, /require_test_cluster_write_guard\(\)/, 'common helpers must define the explicit test-cluster write guard');
  assert.match(common, /TEST_CLUSTER_CONTEXT/, 'write guard must require an explicit target context');
  assert.match(common, /kubectl config current-context/, 'write guard must compare the active kubectl context exactly');
  assert.match(common, /CONFIRM_TEST_CLUSTER[\s\S]*phrase="apply-to-explicit-test-cluster"/, 'write guard must require the unambiguous confirmation phrase');
  assert.match(migrate, /require_test_cluster_write_guard[\s\S]*assert_backup_covers_current_mappings/, 'migration apply must pass the test-cluster guard before OpenBao writes');
  assert.match(migrate, /CONFIRM_SECRET_OVERWRITE=overwrite-existing-openbao-values/, 'migration overwrite mode must require an explicit guard');
  assert.match(migrate, /refusing to overwrite/, 'migration must fail closed on destination mismatch');
  assert.match(migrate, /diff summary: match=\$matches missing=\$missing mismatch=\$mismatches/, 'migration dry-run must report a real destination diff');
  assert.match(migrate, /merge_source_backup_into_target/, 'migration must deliberately merge backed-up external source KV before applying mapped overlays');

  assert.match(restore, /helm -n "\$NS" rollback "\$RELEASE" "\$revision"/, 'restore must provide executable Helm rollback for the configured release');
  assert.match(restore, /kubectl -n "\$NS" apply -f "\$backup_dir\/kubernetes\/secrets\.apply\.json"/, 'restore must restore Kubernetes Secrets from the backup');
  assert.match(restore, /\[ "\$MODE" = "--apply" \][\s\S]*require_test_cluster_write_guard/, 'restore apply/helm rollback path must pass the test-cluster guard before writes');

  assert.match(health, /app\.kubernetes\.io\/instance=\$RELEASE/, 'health check must select workloads by release label');
  assert.doesNotMatch(health, /deploy\/falcone-|statefulset\/falcone-/, 'health check must not hard-code the falcone release name');

  assert.match(diff, /helm diff upgrade --install "\$RELEASE" "\$CHART" -n "\$NS"/, 'diff gate must use helm diff when available');
  assert.match(diff, /helm template "\$RELEASE" "\$CHART" -n "\$NS"/, 'diff gate must render manifests as a fallback');
  assert.match(diff, /kubectl -n "\$NS" diff -f "\$tmp\/rendered\.yaml"/, 'diff gate fallback must use read-only kubectl diff');
  assert.equal((statSync(resolve(CUTOVER_SCRIPTS, 'diff-rollout.sh')).mode & 0o111) !== 0, true, 'diff gate must be executable');
});
