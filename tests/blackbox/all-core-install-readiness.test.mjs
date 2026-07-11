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
  assert.match(out, /name:\s*falcone-temporal-db-bootstrap[\s\S]*helm\.sh\/hook-weight:\s*"-1"/, 'Temporal DB bootstrap must run before schema hook');
  assert.match(out, /CREATE ROLE %I LOGIN CREATEDB PASSWORD %L/, 'Temporal bootstrap must create the role idempotently');
  assert.match(out, /name:\s*"in-falcone-temporal"[\s\S]*key:\s*"password"/, 'Temporal schema/bootstrap must use the generated Temporal Secret');
  assert.match(out, /SQL_USER[\s\S]*value:\s*"temporal"[\s\S]*SQL_PASSWORD[\s\S]*secretKeyRef:/, 'Temporal schema job must use the same role and Secret');
});

test('all-core-006: Helm owns the /v1/mcp route, executor RBAC, and pullable default image refs', SKIP, () => {
  const base = assertRender();
  assert.match(base, /route-2018-mcp\.json:[\s\S]*"uri": "\/v1\/mcp\/\*"/, 'bootstrap payload must include the MCP APISIX route');
  assert.match(base, /falcone-control-plane-executor\.review-ns\.svc\.cluster\.local:8080/, 'MCP route must target the Helm-owned executor service');
  assert.match(base, /kind:\s*RoleBinding[\s\S]*name:\s*falcone-mcp-runtime[\s\S]*namespace:\s*review-ns[\s\S]*kind:\s*ServiceAccount[\s\S]*name:\s*falcone-control-plane-executor[\s\S]*namespace:\s*review-ns/, 'MCP RBAC must bind the executor service account in the release namespace');
  assert.doesNotMatch(base, /ghcr\.io\/example/, 'fresh install values must not use example image repositories');
  assert.doesNotMatch(base, /localhost:30500\/in-falcone-/, 'fresh install base values must not render localhost-only project images');
  assert.doesNotMatch(base, /image:\s*['"]?docker\.io\/bitnami\/(postgresql:17\.2\.0|kafka:3\.9\.0|kubectl:1\.32\.2)/, 'fresh install must not render removed bitnami image tags');
  assert.doesNotMatch(base, /image:\s*"docker\.io\/apache\/apisix:3\.10\.0"/, 'fresh install must not render the missing APISIX tag');
  assert.doesNotMatch(base, /image:\s*"docker\.io\/prom\/prometheus:3\.2\.1"/, 'fresh install must not render the missing Prometheus tag');
  assert.match(base, /image:\s*"docker\.io\/apache\/apisix:3\.10\.0-debian"/, 'APISIX must use the verified pullable Debian tag');
  assert.match(base, /image:\s*"docker\.io\/prom\/prometheus@sha256:6927e0919a144aa7616fd0137d4816816d42f6b816de3af269ab065250859a62"/, 'Prometheus must use the verified v3.2.1 manifest digest');
  assert.match(base, /image:\s*"docker\.io\/bitnamilegacy\/postgresql:17\.2\.0"/, 'PostgreSQL must use the verified bitnamilegacy image');
  assert.match(base, /image:\s*"docker\.io\/bitnamilegacy\/kafka:3\.9\.0"/, 'Kafka must use the verified bitnamilegacy image');
  assert.match(base, /image:\s*"docker\.io\/bitnamilegacy\/kubectl:1\.32\.2"/, 'bootstrap jobs must use the verified bitnamilegacy kubectl image');
  const releaseTag = '0.3.0';
  for (const image of [
    'in-falcone-control-plane',
    'in-falcone-control-plane-executor',
    'in-falcone-workflow-worker',
    'in-falcone-web-console',
  ]) {
    assert.match(base, new RegExp(`image:\\s*"ghcr\\.io/gntik-ai/${image}:${escapeRe(releaseTag)}"`), `${image} must use the chart app release tag`);
  }
  assert.match(base, /value:\s*ghcr\.io\/gntik-ai\/in-falcone-mcp-runtime:0\.3\.0/, 'default MCP runtime env must use the chart app release tag');
  assert.doesNotMatch(base, /ghcr\.io\/gntik-ai\/in-falcone-[^:\s"]+:(0\.1\.0|0\.2\.11|0\.6\.2|0\.9\.3)/, 'first-party defaults must not mix stale component tags');
  const valuesYaml = readFileSync(resolve(CHART_PATH, 'values.yaml'), 'utf8');
  assert.match(valuesYaml, /mcp:\n[\s\S]*runtimeImage:\n[\s\S]*repository:\s*ghcr\.io\/gntik-ai\/in-falcone-mcp-runtime\n[\s\S]*tag:\s*0\.3\.0/, 'mcp.runtimeImage values must use the chart app release tag');

  const kind = assertRender(['-f', KIND_VALUES]);
  assert.match(kind, /image:\s*"localhost:30500\/in-falcone-control-plane-executor:0\.9\.3"/, 'kind overlay must use the local executor image');
  assert.match(kind, /image:\s*"localhost:30500\/in-falcone-workflow-worker:0\.1\.0"/, 'kind overlay must use the local workflow-worker image');
  assert.match(kind, /image:\s*"localhost:30500\/in-falcone-web-console:0\.2\.11"/, 'kind overlay must use the local web-console image');
  assert.match(kind, /value:\s*localhost:30500\/in-falcone-mcp-runtime/, 'kind overlay must use the local MCP runtime image');
  assert.doesNotMatch(kind, /MCP_RUNTIME_IMAGE_DIGEST/, 'kind overlay must not carry an unverified MCP runtime digest');

  const releaseWorkflow = readFileSync(resolve(REPO_ROOT, '.github', 'workflows', 'release-images.yml'), 'utf8');
  const mcpDockerfile = readFileSync(resolve(REPO_ROOT, 'apps', 'mcp-runtime', 'Dockerfile'), 'utf8');
  assert.match(releaseWorkflow, /image:\s*in-falcone-mcp-runtime[\s\S]*dockerfile:\s*apps\/mcp-runtime\/Dockerfile/, 'release workflow must publish the MCP runtime image');
  assert.match(mcpDockerfile, /COPY apps\/control-plane\/src\/mcp-official-server\.mjs/, 'MCP runtime image must build from the production MCP server modules');
});

test('all-core-007: ESO operator, webhook, cert-controller, CRDs, and auxiliary namespaces render', SKIP, () => {
  const vendoredChart = readFileSync(resolve(CHART_PATH, 'charts', 'eso', 'charts', 'external-secrets', 'Chart.yaml'), 'utf8');
  assert.match(vendoredChart, /name:\s*external-secrets/, 'ESO wrapper must vendor the upstream external-secrets chart');
  assert.match(vendoredChart, /version:\s*0\.9\.0/, 'vendored external-secrets chart version must match the wrapper dependency pin');
  const docs = renderDocs();
  assert.ok(findDoc(docs, 'Namespace', 'review-ns'), 'release namespace must render for a fresh install');
  assert.ok(findDoc(docs, 'Namespace', 'eso-system'), 'ESO auth namespace must render for a fresh install');
  assert.ok(findDoc(docs, 'Namespace', 'secret-store'), 'OpenBao namespace must render for a fresh install');
  assert.ok(findDoc(docs, 'Deployment', 'eso-external-secrets'), 'ESO controller Deployment must render');
  assert.ok(findDoc(docs, 'Deployment', 'eso-external-secrets-webhook'), 'ESO admission webhook Deployment must render');
  assert.ok(findDoc(docs, 'Deployment', 'eso-external-secrets-cert-controller'), 'ESO cert-controller Deployment must render');
  assert.ok(findDoc(docs, 'CustomResourceDefinition', 'externalsecrets.external-secrets.io'), 'ExternalSecret CRD must render from the vendored dependency');
  assert.ok(findDoc(docs, 'CustomResourceDefinition', 'clustersecretstores.external-secrets.io'), 'ClusterSecretStore CRD must render from the vendored dependency');
  const out = assertRender();
  assert.doesNotMatch(out, /eso-crd-extract-external-secrets-webhook/, 'stale extracted CRD webhook names must not render');
  assert.doesNotMatch(out, /namespace:\s*default\b/, 'CRD conversion webhooks must not point at the default namespace');
  assert.match(out, /kubectl -n review-ns get endpoints eso-external-secrets-webhook/, 'webhook wait Job must wait for the actual release-owned webhook Service');
});

test('all-core-008: ESO cluster-scoped ownership preflight renders', SKIP, () => {
  const out = assertRender();
  assert.match(out, /kind:\s*Job[\s\S]*name:\s*eso-preflight/, 'ESO ownership preflight Job must render');
  assert.match(out, /resources:\s*\["clustersecretstores"\]/, 'preflight must inspect ClusterSecretStore ownership');
  assert.match(out, /resources:\s*\["deployments"\]/, 'preflight must inspect cluster ESO deployments');
  assert.match(out, /adoptExisting/, 'preflight must expose the explicit adoptExisting override');
  assert.match(out, /review-ns\/\*\) ;;/, 'preflight must allow the release-owned ESO operator deployment');
  assert.match(out, /set eso\.eso\.clusterOwnership\.adoptExisting=true/, 'preflight must fail closed on unowned cluster-scoped stores');
});

test('all-core-009: OpenBao auth and RBAC honor a custom ESO namespace', SKIP, () => {
  const out = assertRender([
    '--set', 'eso.eso.namespace=custom-eso',
    '--set', 'openbao.eso.namespace=custom-eso',
  ]);
  assert.match(out, /name:\s*eso-openbao-auth[\s\S]*namespace:\s*custom-eso/, 'OpenBao must render ESO auth ServiceAccount in the configured ESO namespace');
  assert.match(out, /bound_service_account_namespaces='custom-eso'/, 'OpenBao Kubernetes auth role for ESO must bind the configured ESO namespace');
  assert.match(out, /kubernetes\.io\/metadata\.name:\s*custom-eso/, 'OpenBao NetworkPolicy must allow the configured ESO namespace');
  assert.doesNotMatch(out, /bound_service_account_namespaces='eso-system'/, 'custom ESO namespace must not leave the auth role hard-coded to eso-system');
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
  assert.match(migrate, /CONFIRM_SECRET_OVERWRITE=overwrite-existing-openbao-values/, 'migration overwrite mode must require an explicit guard');
  assert.match(migrate, /refusing to overwrite/, 'migration must fail closed on destination mismatch');
  assert.match(migrate, /diff summary: match=\$matches missing=\$missing mismatch=\$mismatches/, 'migration dry-run must report a real destination diff');
  assert.match(migrate, /merge_source_backup_into_target/, 'migration must deliberately merge backed-up external source KV before applying mapped overlays');

  assert.match(restore, /helm -n "\$NS" rollback "\$RELEASE" "\$revision"/, 'restore must provide executable Helm rollback for the configured release');
  assert.match(restore, /kubectl -n "\$NS" apply -f "\$backup_dir\/kubernetes\/secrets\.apply\.json"/, 'restore must restore Kubernetes Secrets from the backup');

  assert.match(health, /app\.kubernetes\.io\/instance=\$RELEASE/, 'health check must select workloads by release label');
  assert.doesNotMatch(health, /deploy\/falcone-|statefulset\/falcone-/, 'health check must not hard-code the falcone release name');

  assert.match(diff, /helm diff upgrade --install "\$RELEASE" "\$CHART" -n "\$NS"/, 'diff gate must use helm diff when available');
  assert.match(diff, /helm template "\$RELEASE" "\$CHART" -n "\$NS"/, 'diff gate must render manifests as a fallback');
  assert.match(diff, /kubectl -n "\$NS" diff -f "\$tmp\/rendered\.yaml"/, 'diff gate fallback must use read-only kubectl diff');
  assert.equal((statSync(resolve(CUTOVER_SCRIPTS, 'diff-rollout.sh')).mode & 0o111) !== 0, true, 'diff gate must be executable');
});
