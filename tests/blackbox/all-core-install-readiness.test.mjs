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
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CHART_PATH = resolve(REPO_ROOT, 'charts', 'in-falcone');
const KIND_VALUES = resolve(REPO_ROOT, 'deploy', 'kind', 'values-kind.yaml');

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
    ['master-key', 'platform/encryption', 'master-key'],
  ];
  for (const [secretKey, remoteKey, property] of expected) {
    assert.match(out, new RegExp(`secretKey:\\s*${secretKey}[\\s\\S]*remoteRef:\\s*\\{ key:\\s*${remoteKey.replace('/', '\\/')}, property:\\s*${property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\}`), `${secretKey} must map to ${remoteKey}/${property}`);
  }
  for (const property of ['node-id', 'KAFKA_CFG_NODE_ID', 'KAFKA_CFG_PROCESS_ROLES', 'KAFKA_CFG_CONTROLLER_LISTENER_NAMES', 'KAFKA_CFG_CONTROLLER_QUORUM_VOTERS', 'KAFKA_CFG_LISTENERS', 'KAFKA_CFG_ADVERTISED_LISTENERS', 'KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP']) {
    assert.match(out, new RegExp(`${property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}="\\$\\(cred in-falcone-kafka`), `OpenBao init must seed Kafka property ${property}`);
  }
  assert.match(out, /bao kv put secret\/platform\/temporal[\s\S]*visibility-database="\$\(cred in-falcone-temporal visibility-database\)"/, 'OpenBao init must seed Temporal credentials');
  assert.match(out, /bao kv put secret\/platform\/encryption[\s\S]*master-key="\$\(cred in-falcone-encryption master-key\)"/, 'OpenBao init must seed encryption key');
  assert.match(out, /--from-file=root-token=\/openbao-recovery\/root-token/, 'OpenBao recovery Secret must preserve the root token for partial init convergence');
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

test('all-core-006: Helm owns the /v1/mcp route, executor RBAC, and local kind images', SKIP, () => {
  const base = assertRender();
  assert.match(base, /route-2018-mcp\.json:[\s\S]*"uri": "\/v1\/mcp\/\*"/, 'bootstrap payload must include the MCP APISIX route');
  assert.match(base, /falcone-control-plane-executor\.review-ns\.svc\.cluster\.local:8080/, 'MCP route must target the Helm-owned executor service');
  assert.match(base, /kind:\s*RoleBinding[\s\S]*name:\s*falcone-mcp-runtime[\s\S]*namespace:\s*review-ns[\s\S]*kind:\s*ServiceAccount[\s\S]*name:\s*falcone-control-plane-executor[\s\S]*namespace:\s*review-ns/, 'MCP RBAC must bind the executor service account in the release namespace');
  assert.doesNotMatch(base, /ghcr\.io\/example/, 'fresh install values must not use example image repositories');

  const kind = assertRender(['-f', KIND_VALUES]);
  assert.match(kind, /image:\s*"localhost:30500\/in-falcone-control-plane-executor:0\.9\.3"/, 'kind overlay must use the local executor image');
  assert.match(kind, /image:\s*"localhost:30500\/in-falcone-workflow-worker:0\.1\.0"/, 'kind overlay must use the local workflow-worker image');
  assert.match(kind, /image:\s*"localhost:30500\/in-falcone-web-console:0\.2\.11"/, 'kind overlay must use the local web-console image');
  assert.doesNotMatch(kind, /MCP_RUNTIME_IMAGE_DIGEST/, 'kind overlay must not carry an unverified MCP runtime digest');
});

test('all-core-007: ESO cluster-scoped ownership preflight renders', SKIP, () => {
  const out = assertRender();
  assert.match(out, /kind:\s*Job[\s\S]*name:\s*eso-preflight/, 'ESO ownership preflight Job must render');
  assert.match(out, /resources:\s*\["clustersecretstores"\]/, 'preflight must inspect ClusterSecretStore ownership');
  assert.match(out, /resources:\s*\["deployments"\]/, 'preflight must inspect cluster ESO deployments');
  assert.match(out, /adoptExisting/, 'preflight must expose the explicit adoptExisting override');
  assert.match(out, /set eso\.eso\.clusterOwnership\.adoptExisting=true/, 'preflight must fail closed on unowned cluster-scoped stores');
});
