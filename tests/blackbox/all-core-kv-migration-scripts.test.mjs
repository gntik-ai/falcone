import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SCRIPT_DIR = resolve(REPO_ROOT, 'scripts', 'system-changes', 'make-all-services-core');

const PLATFORM_MAPPINGS = [
  ['in-falcone-postgresql', 'POSTGRESQL_USERNAME'],
  ['in-falcone-postgresql', 'POSTGRESQL_PASSWORD'],
  ['in-falcone-postgresql', 'POSTGRESQL_POSTGRES_PASSWORD'],
  ['in-falcone-postgresql-vector', 'POSTGRES_USER'],
  ['in-falcone-postgresql-vector', 'POSTGRES_PASSWORD'],
  ['in-falcone-postgresql-vector', 'POSTGRES_DB'],
  ['in-falcone-documentdb', 'POSTGRES_USER'],
  ['in-falcone-documentdb', 'POSTGRES_PASSWORD'],
  ['in-falcone-documentdb', 'POSTGRES_DB'],
  ['in-falcone-ferretdb', 'postgresql-url'],
  ['in-falcone-documentdb-replication', 'password'],
  ['in-falcone-documentdb-replication', 'realtime-url'],
  ['in-falcone-kafka', 'KAFKA_CFG_NODE_ID'],
  ['in-falcone-kafka', 'KAFKA_CFG_PROCESS_ROLES'],
  ['in-falcone-kafka', 'KAFKA_CFG_CONTROLLER_LISTENER_NAMES'],
  ['in-falcone-kafka', 'KAFKA_CFG_CONTROLLER_QUORUM_VOTERS'],
  ['in-falcone-kafka', 'KAFKA_CFG_LISTENERS'],
  ['in-falcone-kafka', 'KAFKA_CFG_ADVERTISED_LISTENERS'],
  ['in-falcone-kafka', 'KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP'],
  ['in-falcone-storage', 's3_access_key'],
  ['in-falcone-storage', 's3_secret_key'],
  ['in-falcone-temporal', 'username'],
  ['in-falcone-temporal', 'password'],
  ['in-falcone-temporal', 'database'],
  ['in-falcone-temporal', 'visibility-database'],
  ['in-falcone-encryption', 'master-key'],
  ['in-falcone-apisix-admin', 'admin-key'],
  ['in-falcone-gateway-shared-secret', 'secret'],
  ['in-falcone-keycloak-admin', 'username'],
  ['in-falcone-keycloak-admin', 'password'],
  ['in-falcone-identity-client', 'client-id'],
  ['in-falcone-identity-client', 'client-secret'],
  ['in-falcone-superadmin', 'password'],
];

function makeKubernetesSecrets(overrides = {}) {
  const secrets = {};
  for (const [secret, key] of PLATFORM_MAPPINGS) {
    secrets[secret] ??= {};
    secrets[secret][key] = overrides[`${secret}/${key}`] ?? `k8s:${secret}:${key}`;
  }
  return secrets;
}

function clusterSecretStore(
  name,
  { owned = true, openbaoNamespace = 'secret-store', releaseName, releaseNamespace, ready = true } = {},
) {
  const helmReleaseName = releaseName ?? (owned ? 'falcone' : 'other-release');
  const helmReleaseNamespace = releaseNamespace ?? (owned ? 'falcone' : 'other-ns');
  return {
    apiVersion: 'external-secrets.io/v1beta1',
    kind: 'ClusterSecretStore',
    metadata: {
      name,
      labels: owned ? {
        'app.kubernetes.io/instance': helmReleaseName,
        'app.kubernetes.io/part-of': 'in-falcone',
      } : {
        'app.kubernetes.io/instance': helmReleaseName,
        'app.kubernetes.io/part-of': 'other-platform',
      },
      annotations: owned ? {
        'meta.helm.sh/release-name': helmReleaseName,
        'meta.helm.sh/release-namespace': helmReleaseNamespace,
      } : {
        'meta.helm.sh/release-name': helmReleaseName,
        'meta.helm.sh/release-namespace': helmReleaseNamespace,
      },
    },
    spec: {
      provider: {
        vault: {
          server: `https://openbao.${openbaoNamespace}.svc.cluster.local:8200`,
        },
      },
    },
    status: {
      conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }],
    },
  };
}

function writeExecutable(path, source) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

function makeHarness(t, initialState) {
  const root = mkdtempSync(join(tmpdir(), 'falcone-kv-migration-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const stateFile = join(root, 'state.json');
  writeFileSync(stateFile, JSON.stringify(initialState, null, 2));

  writeExecutable(join(bin, 'bao'), `#!/usr/bin/env node
const fs = require('fs');
const stateFile = process.env.BAO_FAKE_STATE;
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const context = (process.env.BAO_ADDR || '').includes('source') ? 'source' : 'target';
state[context] ||= {};
const args = process.argv.slice(2);
function save() { fs.writeFileSync(stateFile, JSON.stringify(state, null, 2)); }
function splitRef(ref) {
  const i = ref.indexOf('/');
  if (i < 0) return [ref, ''];
  return [ref.slice(0, i), ref.slice(i + 1)];
}
function storeFor(mount) {
  state[context][mount] ||= {};
  return state[context][mount];
}
function kvList(ref) {
  if (process.env.BAO_FAKE_LIST_FAIL_CONTEXT === context) {
    console.error('permission denied');
    process.exit(3);
  }
  const [mount, rawPrefix] = splitRef(ref);
  const prefix = rawPrefix.replace(/^\\/+/, '');
  const store = storeFor(mount);
  const entries = new Set();
  for (const path of Object.keys(store)) {
    if (prefix && !path.startsWith(prefix)) continue;
    const rest = prefix ? path.slice(prefix.length) : path;
    if (!rest) continue;
    const slash = rest.indexOf('/');
    entries.add(slash === -1 ? rest : rest.slice(0, slash + 1));
  }
  if (entries.size === 0) {
    console.error('No value found at ' + ref);
    process.exit(2);
  }
  console.log(JSON.stringify([...entries].sort()));
}
function kvGet(ref) {
  const [mount, path] = splitRef(ref);
  if (process.env.BAO_FAKE_EXPORT_GET_FAIL_CONTEXT === context && process.env.BAO_FAKE_EXPORT_GET_FAIL_PATH === path) {
    console.error('permission denied');
    process.exit(3);
  }
  if (context === 'target' && process.env.BAO_FAKE_GET_FAIL_PATH === path) {
    console.error('permission denied');
    process.exit(3);
  }
  const value = storeFor(mount)[path];
  if (!value) {
    console.error('No value found at ' + ref);
    process.exit(2);
  }
  console.log(JSON.stringify({ data: { data: value, metadata: { version: 1 } } }));
}
function kvPut(ref, pairs) {
  const [mount, path] = splitRef(ref);
  if (pairs.length === 1 && pairs[0].startsWith('@')) {
    storeFor(mount)[path] = JSON.parse(fs.readFileSync(pairs[0].slice(1), 'utf8'));
    save();
    return;
  }
  const next = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const key = pair.slice(0, eq);
    const valueSpec = pair.slice(eq + 1);
    next[key] = valueSpec.startsWith('@') ? fs.readFileSync(valueSpec.slice(1), 'utf8') : valueSpec;
  }
  storeFor(mount)[path] = next;
  save();
}
function kvDelete(ref) {
  const [mount, path] = splitRef(ref);
  if (process.env.BAO_FAKE_DELETE_FAIL_PATH === path) process.exit(3);
  delete storeFor(mount)[path];
  save();
}
if (args[0] === 'status') {
  if (process.env.BAO_FAKE_STATUS_FAIL_CONTEXT === context) {
    console.error('target OpenBao unavailable');
    process.exit(3);
  }
  console.log(JSON.stringify({ initialized: true, sealed: false }));
  process.exit(0);
}
if (args[0] !== 'kv') process.exit(2);
if (args[1] === 'list') kvList(args[args.length - 1]);
else if (args[1] === 'get') kvGet(args[args.length - 1]);
else if (args[1] === 'put') kvPut(args[2], args.slice(3));
else if (args[1] === 'delete') kvDelete(args[2]);
else if (args[1] === 'metadata' && args[2] === 'delete') kvDelete(args[3]);
else process.exit(2);
`);

  writeExecutable(join(bin, 'kubectl'), `#!/usr/bin/env node
const fs = require('fs');
const state = JSON.parse(fs.readFileSync(process.env.BAO_FAKE_STATE, 'utf8'));
const args = process.argv.slice(2);
function save() { fs.writeFileSync(process.env.BAO_FAKE_STATE, JSON.stringify(state, null, 2)); }
function b64(value) { return Buffer.from(String(value)).toString('base64'); }
function secretObject(name, data) {
  const encoded = {};
  for (const [key, value] of Object.entries(data || {})) encoded[key] = b64(value);
  return { apiVersion: 'v1', kind: 'Secret', metadata: { name }, data: encoded };
}
function print(obj) { console.log(JSON.stringify(obj)); }
if (args[0] === 'config' && args[1] === 'current-context') {
  console.log(process.env.KUBECTL_CONTEXT || 'test-context');
  process.exit(0);
}
if (args.includes('rollout') && args.includes('status')) process.exit(0);
if (args.includes('exec')) process.exit(0);
if (args.includes('apply')) {
  const fileIndex = args.indexOf('-f');
  const file = fileIndex >= 0 ? args[fileIndex + 1] : '';
  if (file && file !== '-') {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const items = Array.isArray(parsed.items) ? parsed.items : [parsed];
    state.applied ??= {};
    state.applied.clusterSecretStores ??= [];
    state.applied.kinds ??= [];
    state.applied.secrets ??= [];
    for (const item of items) {
      if (item?.kind) state.applied.kinds.push(item.kind);
      if (item?.kind === 'Secret' && item?.metadata?.name) {
        state.applied.secrets.push(item.metadata.name);
      }
      if (item?.kind === 'ClusterSecretStore' && item?.metadata?.name) {
        state.applied.clusterSecretStores.push(item.metadata.name);
      }
    }
    save();
  }
  process.exit(0);
}
const getIndex = args.indexOf('get');
if (getIndex === -1) process.exit(2);
const resource = args[getIndex + 1];
const name = args[getIndex + 2] && !args[getIndex + 2].startsWith('-') ? args[getIndex + 2] : '';
const failureResource = process.env.KUBECTL_FAKE_GET_FAIL_RESOURCE || '';
if (failureResource === resource || (name && failureResource === resource + '/' + name)) {
  console.error(process.env.KUBECTL_FAKE_GET_FAIL_STDERR || 'Error from server (Forbidden): denied');
  process.exit(Number(process.env.KUBECTL_FAKE_GET_FAIL_CODE || 1));
}
if (resource === 'secret' && name) {
  print(secretObject(name, state.kubernetes?.[name]));
  process.exit(0);
}
if (resource === 'secrets') {
  print({ apiVersion: 'v1', kind: 'SecretList', items: Object.entries(state.kubernetes || {}).map(([n, d]) => secretObject(n, d)) });
  process.exit(0);
}
if (resource === 'externalsecret') {
  const externalSecrets = state.externalSecrets || [];
  print({
    apiVersion: 'external-secrets.io/v1beta1',
    kind: 'ExternalSecretList',
    items: externalSecrets.map((item) => ({
      metadata: { name: item.name },
      status: { conditions: [{ type: 'Ready', status: item.status || 'True' }] },
    })),
  });
  process.exit(0);
}
if (resource === 'deploy,statefulset') {
  const workloads = state.workloads || ['deployment/falcone-control-plane'];
  if (args.includes('-o') && args[args.indexOf('-o') + 1] === 'name') {
    console.log(workloads.join('\\n'));
    process.exit(0);
  }
  print({ apiVersion: 'v1', kind: 'List', items: [] });
  process.exit(0);
}
if (resource.startsWith('clustersecretstore')) {
  const stores = state.clusterSecretStores || {};
  if (name) {
    if (!stores[name]) {
      console.error('Error from server (NotFound): ' + resource + ' "' + name + '" not found');
      process.exit(1);
    }
    print(stores[name]);
    process.exit(0);
  }
  print({ apiVersion: 'external-secrets.io/v1beta1', kind: 'ClusterSecretStoreList', items: Object.values(stores) });
  process.exit(0);
}
print({ apiVersion: 'v1', kind: 'List', items: [] });
`);

  writeExecutable(join(bin, 'helm'), `#!/usr/bin/env node
const fs = require('fs');
const stateFile = process.env.BAO_FAKE_STATE;
const state = stateFile && fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
const args = process.argv.slice(2);
function save() {
  if (stateFile) fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}
const getIndex = args.indexOf('get');
if (getIndex !== -1) {
  const kind = args[getIndex + 1];
  if (kind === 'values') console.log('testValues: true');
  else if (kind === 'manifest') console.log('---\\nkind: List\\nitems: []');
  else process.exit(2);
  process.exit(0);
}
if (args.includes('history')) {
  console.log(JSON.stringify([{ revision: 6 }]));
  process.exit(0);
}
if (args.includes('status')) {
  console.log(JSON.stringify({ version: 6 }));
  process.exit(0);
}
if (args.includes('rollback')) {
  const rollbackIndex = args.indexOf('rollback');
  state.helmRollbacks ??= [];
  state.helmRollbacks.push({
    release: args[rollbackIndex + 1],
    revision: args[rollbackIndex + 2],
  });
  save();
  process.exit(0);
}
process.exit(2);
`);

  const baseEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    BAO_FAKE_STATE: stateFile,
    NAMESPACE: 'falcone',
    RELEASE: 'falcone',
    OPENBAO_NAMESPACE: 'secret-store',
    BAO_KV_MOUNT: 'secret',
    SOURCE_BAO_KV_MOUNT: 'secret',
    TEST_CLUSTER_CONTEXT: 'test-context',
    CONFIRM_TEST_CLUSTER: 'apply-to-explicit-test-cluster',
  };

  return {
    root,
    stateFile,
    run(script, args = [], env = {}) {
      return spawnSync('bash', [resolve(SCRIPT_DIR, script), ...args], {
        cwd: REPO_ROOT,
        env: { ...baseEnv, ...env },
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      });
    },
    state() {
      return JSON.parse(readFileSync(stateFile, 'utf8'));
    },
  };
}

test('all-core KV backup and restore scope ClusterSecretStores to Falcone openbao-backend', (t) => {
  const h = makeHarness(t, {
    target: { secret: {} },
    source: { secret: {} },
    kubernetes: makeKubernetesSecrets(),
    clusterSecretStores: {
      'openbao-backend': clusterSecretStore('openbao-backend'),
      'unrelated-store': clusterSecretStore('unrelated-store', { owned: false, openbaoNamespace: 'other-store' }),
    },
  });
  const backup = join(h.root, 'scoped-css-backup.tgz');
  const baoEnv = {
    BAO_ADDR: 'https://target-openbao.test',
    BAO_TOKEN: 'target-token',
  };

  const backupRun = h.run('backup-kv.sh', ['--output', backup], baoEnv);
  assert.equal(backupRun.status, 0, `backup must succeed\nstdout: ${backupRun.stdout}\nstderr: ${backupRun.stderr}`);
  const archived = spawnSync('tar', ['-xOf', backup, 'eso/clustersecretstores.apply.json'], { encoding: 'utf8' });
  assert.equal(archived.status, 0, `cluster store backup must be extractable\nstderr: ${archived.stderr}`);
  const archivedStores = JSON.parse(archived.stdout);
  assert.deepEqual(
    (archivedStores.items ?? []).map((item) => item.metadata.name),
    ['openbao-backend'],
    'backup archive must not include unrelated cluster-scoped ESO stores',
  );

  const restoreRun = h.run('restore-kv.sh', ['--backup', backup, '--apply'], baoEnv);
  assert.equal(restoreRun.status, 0, `restore must succeed\nstdout: ${restoreRun.stdout}\nstderr: ${restoreRun.stderr}`);
  assert.deepEqual(
    h.state().applied?.clusterSecretStores,
    ['openbao-backend'],
    'restore must apply only the Falcone-owned OpenBao ClusterSecretStore',
  );
});

test('all-core KV backup refuses unowned openbao-backend ClusterSecretStore', (t) => {
  const h = makeHarness(t, {
    target: { secret: {} },
    source: { secret: {} },
    kubernetes: makeKubernetesSecrets(),
    clusterSecretStores: {
      'openbao-backend': clusterSecretStore('openbao-backend', { owned: false }),
    },
  });
  const backup = join(h.root, 'unowned-css-backup.tgz');

  const backupRun = h.run('backup-kv.sh', ['--output', backup]);
  assert.notEqual(backupRun.status, 0, 'backup must fail closed for an unowned cluster-scoped openbao-backend store');
  assert.match(
    `${backupRun.stdout}\n${backupRun.stderr}`,
    /refusing ClusterSecretStore backup\/restore outside Falcone-owned openbao-backend/,
  );
  assert.equal(existsSync(backup), false, 'failed ClusterSecretStore ownership check must not publish a backup archive');
});

test('all-core KV backup refuses same-release-name ClusterSecretStore from another namespace', (t) => {
  const h = makeHarness(t, {
    target: { secret: {} },
    source: { secret: {} },
    kubernetes: makeKubernetesSecrets(),
    clusterSecretStores: {
      'openbao-backend': clusterSecretStore('openbao-backend', { releaseNamespace: 'other-ns' }),
    },
  });
  const backup = join(h.root, 'wrong-namespace-css-backup.tgz');

  const backupRun = h.run('backup-kv.sh', ['--output', backup]);
  assert.notEqual(
    backupRun.status,
    0,
    'backup must fail closed when openbao-backend belongs to the same release name in another namespace',
  );
  assert.match(
    `${backupRun.stdout}\n${backupRun.stderr}`,
    /refusing ClusterSecretStore backup\/restore outside Falcone-owned openbao-backend/,
  );
  assert.equal(existsSync(backup), false, 'failed ClusterSecretStore namespace check must not publish a backup archive');
});

test('all-core health check refuses same-release-name ClusterSecretStore from another namespace', (t) => {
  const h = makeHarness(t, {
    target: { secret: {} },
    source: { secret: {} },
    kubernetes: makeKubernetesSecrets(),
    externalSecrets: [{ name: 'platform-postgresql-credentials' }],
    workloads: ['deployment/falcone-control-plane'],
    clusterSecretStores: {
      'openbao-backend': clusterSecretStore('openbao-backend', { releaseNamespace: 'other-ns' }),
    },
  });

  const healthRun = h.run('health-check.sh');
  assert.notEqual(
    healthRun.status,
    0,
    'health check must fail closed when openbao-backend belongs to the same release name in another namespace',
  );
  assert.match(
    `${healthRun.stdout}\n${healthRun.stderr}`,
    /refusing ClusterSecretStore backup\/restore outside Falcone-owned openbao-backend/,
  );
});

test('all-core KV migration scripts recursively migrate source KV and restore target exactly', (t) => {
  const initialTarget = {
    secret: {
      'platform/postgresql': {
        username: 'TARGET_OLD_USERNAME',
        'target-only': 'TARGET_ONLY_VALUE',
        targetJson: { preserved: true, count: 2 },
      },
      'target/existing': { keep: 'TARGET_KEEP_VALUE' },
    },
  };
  const h = makeHarness(t, {
    target: JSON.parse(JSON.stringify(initialTarget)),
    source: {
      secret: {
        'platform/postgresql': {
          username: 'SOURCE_USERNAME',
          'source-only': 'SOURCE_ONLY_VALUE',
          sourceJson: { imported: true, levels: [1, 2, 3] },
        },
        'workspace/acme/nested/api': {
          token: 'SOURCE_NESTED_TOKEN',
          url: 'https://source.example.test',
          limits: { rpm: 120, burst: 10 },
          enabled: true,
        },
        'unmapped/deep/path': {
          alpha: 'SOURCE_ALPHA',
          beta: 'SOURCE_BETA',
          nested: { owner: 'workspace-a', weights: [3, 5, 8] },
        },
      },
    },
    kubernetes: makeKubernetesSecrets({
      'in-falcone-postgresql/POSTGRESQL_USERNAME': 'K8S_USERNAME',
      'in-falcone-postgresql/POSTGRESQL_PASSWORD': 'K8S_APP_PASSWORD',
      'in-falcone-postgresql/POSTGRESQL_POSTGRES_PASSWORD': 'K8S_ROOT_PASSWORD',
    }),
  });
  const backup = join(h.root, 'backup.tgz');
  const baoEnv = {
    BAO_ADDR: 'https://target-openbao.test',
    BAO_TOKEN: 'target-token',
    SOURCE_BAO_ADDR: 'https://source-openbao.test',
    SOURCE_BAO_TOKEN: 'source-token',
  };

  const backupRun = h.run('backup-kv.sh', ['--output', backup], baoEnv);
  assert.equal(backupRun.status, 0, `backup must succeed\nstdout: ${backupRun.stdout}\nstderr: ${backupRun.stderr}`);

  const mappedReadFailure = h.run('migrate-platform-secrets.sh', ['--apply', '--backup', backup], {
    ...baoEnv,
    BAO_FAKE_GET_FAIL_PATH: 'platform/postgresql',
  });
  assert.notEqual(mappedReadFailure.status, 0, 'a mapped target read error must fail closed before any target KV write');
  assert.match(`${mappedReadFailure.stdout}\n${mappedReadFailure.stderr}`, /refusing to treat the read error as an absent path/);
  assert.deepEqual(h.state().target, initialTarget, 'a mapped target read error must not be treated as a missing mapped property');

  const dryRun = h.run('migrate-platform-secrets.sh', ['--dry-run', '--backup', backup], baoEnv);
  assert.equal(dryRun.status, 0, `dry-run must succeed\nstdout: ${dryRun.stdout}\nstderr: ${dryRun.stderr}`);
  const dryOutput = `${dryRun.stdout}\n${dryRun.stderr}`;
  for (const secret of ['SOURCE_NESTED_TOKEN', 'SOURCE_ALPHA', 'K8S_USERNAME', 'K8S_APP_PASSWORD']) {
    assert.equal(dryOutput.includes(secret), false, `dry-run must not print secret value ${secret}`);
  }
  assert.match(dryOutput, /diff summary: match=\d+ missing=\d+ mismatch=\d+/, 'dry-run must print only status and fingerprints');

  const applyEnv = { ...baoEnv, CONFIRM_SECRET_OVERWRITE: 'overwrite-existing-openbao-values' };
  const applyRun = h.run('migrate-platform-secrets.sh', ['--apply', '--backup', backup, '--allow-overwrite'], applyEnv);
  assert.equal(applyRun.status, 0, `apply must succeed\nstdout: ${applyRun.stdout}\nstderr: ${applyRun.stderr}`);

  const migrated = h.state().target.secret;
  assert.equal(migrated['platform/postgresql'].username, 'K8S_USERNAME', 'mapped Kubernetes Secret value must overwrite mapped source/target property');
  assert.equal(migrated['platform/postgresql']['app-password'], 'K8S_APP_PASSWORD', 'mapped app password must be written');
  assert.equal(migrated['platform/postgresql']['root-password'], 'K8S_ROOT_PASSWORD', 'mapped root password must be written');
  assert.equal(migrated['platform/postgresql']['target-only'], 'TARGET_ONLY_VALUE', 'target-only unmapped property must survive migration');
  assert.equal(migrated['platform/postgresql']['source-only'], 'SOURCE_ONLY_VALUE', 'source unmapped property at a mapped path must survive migration');
  assert.deepEqual(migrated['platform/postgresql'].targetJson, { preserved: true, count: 2 }, 'target non-string property at a mapped path must stay typed');
  assert.deepEqual(migrated['platform/postgresql'].sourceJson, { imported: true, levels: [1, 2, 3] }, 'source non-string property at a mapped path must stay typed');
  assert.deepEqual(migrated['workspace/acme/nested/api'], {
    token: 'SOURCE_NESTED_TOKEN',
    url: 'https://source.example.test',
    limits: { rpm: 120, burst: 10 },
    enabled: true,
  }, 'nested source KV path must migrate losslessly');
  assert.deepEqual(migrated['unmapped/deep/path'], {
    alpha: 'SOURCE_ALPHA',
    beta: 'SOURCE_BETA',
    nested: { owner: 'workspace-a', weights: [3, 5, 8] },
  }, 'arbitrary unmapped source KV path must migrate losslessly');
  assert.deepEqual(migrated['target/existing'], { keep: 'TARGET_KEEP_VALUE' }, 'pre-existing target path outside mappings must survive migration');

  const afterFirstApply = h.state().target;
  const secondApply = h.run('migrate-platform-secrets.sh', ['--apply', '--backup', backup, '--allow-overwrite'], applyEnv);
  assert.equal(secondApply.status, 0, `second apply must be idempotent\nstdout: ${secondApply.stdout}\nstderr: ${secondApply.stderr}`);
  assert.deepEqual(h.state().target, afterFirstApply, 'second apply must not mutate already-migrated KV data');

  const failedRestoreList = h.run('restore-kv.sh', ['--backup', backup, '--apply'], {
    ...baoEnv,
    BAO_FAKE_LIST_FAIL_CONTEXT: 'target',
  });
  assert.notEqual(failedRestoreList.status, 0, 'exact restore must fail closed when current target KV enumeration fails');
  assert.match(
    `${failedRestoreList.stdout}\n${failedRestoreList.stderr}`,
    /failed to enumerate current target KV paths; exact restore aborted before deletion/,
  );
  assert.deepEqual(h.state().target, afterFirstApply, 'failed restore enumeration must not delete or write target KV data');

  const failedRestore = h.run('restore-kv.sh', ['--backup', backup, '--apply'], {
    ...baoEnv,
    BAO_FAKE_DELETE_FAIL_PATH: 'workspace/acme/nested/api',
  });
  assert.notEqual(failedRestore.status, 0, 'exact restore must fail when a target-only KV path cannot be deleted');
  assert.match(
    `${failedRestore.stdout}\n${failedRestore.stderr}`,
    /failed to delete target-only KV path secret\/workspace\/acme\/nested\/api; exact restore aborted/,
    'delete failure must identify the path and explain that exact restore aborted',
  );

  const restoreRun = h.run('restore-kv.sh', ['--backup', backup, '--apply'], baoEnv);
  assert.equal(restoreRun.status, 0, `restore must succeed\nstdout: ${restoreRun.stdout}\nstderr: ${restoreRun.stderr}`);
  assert.deepEqual(h.state().target, initialTarget, 'restore must return the target KV mount exactly to the captured backup tree');
});

test('all-core KV migration preflights nested source conflicts before any write', (t) => {
  const initialTarget = {
    secret: {
      'unmapped/nested/path': {
        collision: { owner: 'TARGET_OWNER_SECRET', weights: [1, 2] },
        'tab\tline\nkey': 'TARGET_CONTROL_CHAR_SECRET',
        'target-only': 'TARGET_ONLY_SECRET',
      },
    },
  };
  const h = makeHarness(t, {
    target: JSON.parse(JSON.stringify(initialTarget)),
    source: {
      secret: {
        'unmapped/nested/path': {
          collision: { owner: 'SOURCE_OWNER_SECRET', weights: [3, 5] },
          'tab\tline\nkey': 'SOURCE_CONTROL_CHAR_SECRET',
          'source-only': 'SOURCE_ONLY_SECRET',
        },
      },
    },
    kubernetes: makeKubernetesSecrets(),
  });
  const backup = join(h.root, 'conflict-backup.tgz');
  const baoEnv = {
    BAO_ADDR: 'https://target-openbao.test',
    BAO_TOKEN: 'target-token',
    SOURCE_BAO_ADDR: 'https://source-openbao.test',
    SOURCE_BAO_TOKEN: 'source-token',
  };

  const backupRun = h.run('backup-kv.sh', ['--output', backup], baoEnv);
  assert.equal(backupRun.status, 0, `backup must succeed\nstdout: ${backupRun.stdout}\nstderr: ${backupRun.stderr}`);

  const readFailure = h.run('migrate-platform-secrets.sh', ['--apply', '--backup', backup], {
    ...baoEnv,
    BAO_FAKE_GET_FAIL_PATH: 'unmapped/nested/path',
  });
  assert.notEqual(readFailure.status, 0, 'a target read error must fail closed instead of being treated as an absent path');
  assert.match(`${readFailure.stdout}\n${readFailure.stderr}`, /refusing to treat the read error as an absent path/);
  assert.deepEqual(h.state().target, initialTarget, 'a target read error must abort before any target KV write');

  const dryRun = h.run('migrate-platform-secrets.sh', ['--dry-run', '--backup', backup], baoEnv);
  assert.equal(dryRun.status, 0, `dry-run must succeed\nstdout: ${dryRun.stdout}\nstderr: ${dryRun.stderr}`);
  const dryOutput = `${dryRun.stdout}\n${dryRun.stderr}`;
  assert.match(dryOutput, /"path":"unmapped\/nested\/path","property":"collision","status":"conflict","sourceSha256":"[a-f0-9]{64}","targetSha256":"[a-f0-9]{64}"/);
  assert.match(dryOutput, /"property":"tab\\tline\\nkey","status":"conflict"/);
  assert.match(dryOutput, /source KV preflight summary: match=0 missing=1 conflict=2/);
  for (const value of [
    'TARGET_OWNER_SECRET',
    'SOURCE_OWNER_SECRET',
    'TARGET_CONTROL_CHAR_SECRET',
    'SOURCE_CONTROL_CHAR_SECRET',
    'TARGET_ONLY_SECRET',
    'SOURCE_ONLY_SECRET',
  ]) {
    assert.equal(dryOutput.includes(value), false, `dry-run must not expose source or target value ${value}`);
  }

  const refused = h.run('migrate-platform-secrets.sh', ['--apply', '--backup', backup], baoEnv);
  assert.notEqual(refused.status, 0, 'apply without overwrite approval must reject an arbitrary nested source conflict');
  assert.match(`${refused.stdout}\n${refused.stderr}`, /refusing to overwrite 2 existing OpenBao value\(s\) from the external source KV tree/);
  assert.deepEqual(h.state().target, initialTarget, 'conflict refusal must happen before any target KV write');

  const overwrite = h.run('migrate-platform-secrets.sh', ['--apply', '--backup', backup, '--allow-overwrite'], {
    ...baoEnv,
    CONFIRM_SECRET_OVERWRITE: 'overwrite-existing-openbao-values',
  });
  assert.equal(overwrite.status, 0, `captured and explicitly confirmed overwrite must succeed\nstdout: ${overwrite.stdout}\nstderr: ${overwrite.stderr}`);
  assert.deepEqual(h.state().target.secret['unmapped/nested/path'], {
    collision: { owner: 'SOURCE_OWNER_SECRET', weights: [3, 5] },
    'tab\tline\nkey': 'SOURCE_CONTROL_CHAR_SECRET',
    'target-only': 'TARGET_ONLY_SECRET',
    'source-only': 'SOURCE_ONLY_SECRET',
  });

  const restoreRun = h.run('restore-kv.sh', ['--backup', backup, '--apply'], baoEnv);
  assert.equal(restoreRun.status, 0, `restore must succeed\nstdout: ${restoreRun.stdout}\nstderr: ${restoreRun.stderr}`);
  assert.deepEqual(h.state().target, initialTarget, 'restore must exactly recover the captured target after an approved generic overwrite');
});

test('all-core KV migration refuses overwrite when backup did not capture target KV', (t) => {
  const h = makeHarness(t, {
    target: {
      secret: {
        'platform/postgresql': { username: 'TARGET_OLD_USERNAME' },
      },
    },
    source: {
      secret: {
        'unmapped/nested/path': { collision: 'SOURCE_COLLISION' },
      },
    },
    kubernetes: makeKubernetesSecrets({
      'in-falcone-postgresql/POSTGRESQL_USERNAME': 'K8S_USERNAME',
    }),
  });
  const backup = join(h.root, 'no-target-backup.tgz');
  const backupRun = h.run('backup-kv.sh', ['--output', backup], {
    SOURCE_BAO_ADDR: 'https://source-openbao.test',
    SOURCE_BAO_TOKEN: 'source-token',
  });
  assert.equal(backupRun.status, 0, `backup without target OpenBao must still succeed\nstdout: ${backupRun.stdout}\nstderr: ${backupRun.stderr}`);

  const before = h.state().target;
  const applyRun = h.run('migrate-platform-secrets.sh', ['--apply', '--backup', backup, '--allow-overwrite'], {
    BAO_ADDR: 'https://target-openbao.test',
    BAO_TOKEN: 'target-token',
    CONFIRM_SECRET_OVERWRITE: 'overwrite-existing-openbao-values',
  });
  assert.notEqual(applyRun.status, 0, 'overwrite apply must fail without targetKvCaptured=true');
  assert.match(`${applyRun.stdout}\n${applyRun.stderr}`, /targetKvCaptured=true required/, 'failure must explain the target backup requirement');
  assert.deepEqual(h.state().target, before, 'failed overwrite must not write target KV data');
});

test('all-core KV backup fails closed on Kubernetes capture errors', async (t) => {
  const cases = [
    {
      name: 'ExternalSecret RBAC denial',
      resource: 'externalsecret.external-secrets.io',
      stderr: 'Error from server (Forbidden): externalsecrets.external-secrets.io is forbidden',
    },
    {
      name: 'PVC API unavailable',
      resource: 'pvc',
      stderr: 'Unable to connect to the server: dial tcp 127.0.0.1:6443: connect: connection refused',
    },
    {
      name: 'ClusterSecretStore CRD discovery failure',
      resource: 'clustersecretstore.external-secrets.io/openbao-backend',
      stderr: 'Error from server (NotFound): the server could not find the requested resource (get clustersecretstores.external-secrets.io openbao-backend)',
    },
    {
      name: 'ClusterSecretStore generic NotFound',
      resource: 'clustersecretstore.external-secrets.io/openbao-backend',
      stderr: 'NotFound',
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, (st) => {
      const h = makeHarness(st, {
        target: { secret: {} },
        source: { secret: {} },
        kubernetes: makeKubernetesSecrets(),
      });
      const backup = join(h.root, `${testCase.name.replaceAll(' ', '-')}.tgz`);

      const result = h.run('backup-kv.sh', ['--output', backup], {
        KUBECTL_FAKE_GET_FAIL_RESOURCE: testCase.resource,
        KUBECTL_FAKE_GET_FAIL_STDERR: testCase.stderr,
      });

      assert.notEqual(result.status, 0, `${testCase.name} must abort backup creation`);
      assert.match(`${result.stdout}\n${result.stderr}`, /refusing to record resource as absent/);
      assert.equal(existsSync(backup), false, `${testCase.name} must not publish a final backup archive`);
    });
  }
});

test('all-core KV restore rolls back Kubernetes and Helm without target OpenBao', (t) => {
  const h = makeHarness(t, {
    target: { secret: {} },
    source: { secret: {} },
    kubernetes: makeKubernetesSecrets(),
  });
  const backup = join(h.root, 'no-target-restore-backup.tgz');

  const backupRun = h.run('backup-kv.sh', ['--output', backup]);
  assert.equal(backupRun.status, 0, `backup without target OpenBao must succeed\nstdout: ${backupRun.stdout}\nstderr: ${backupRun.stderr}`);
  const archivedStore = spawnSync('tar', ['-xOf', backup, 'eso/clustersecretstores.apply.json'], { encoding: 'utf8' });
  assert.equal(archivedStore.status, 0, `cluster store absence marker must be extractable\nstderr: ${archivedStore.stderr}`);
  assert.deepEqual(
    JSON.parse(archivedStore.stdout),
    {
      absent: true,
      reason: 'NotFound',
      command: 'kubectl get clustersecretstore.external-secrets.io openbao-backend',
      stderr: 'Error from server (NotFound): clustersecretstore.external-secrets.io "openbao-backend" not found\n',
    },
    'optional missing ClusterSecretStore must be the only Kubernetes absent marker',
  );

  const restoreRun = h.run('restore-kv.sh', ['--backup', backup, '--apply', '--helm-rollback']);
  assert.equal(restoreRun.status, 0, `restore must not require target OpenBao\nstdout: ${restoreRun.stdout}\nstderr: ${restoreRun.stderr}`);
  assert.match(`${restoreRun.stdout}\n${restoreRun.stderr}`, /backup has no target OpenBao KV tree; skipping OpenBao KV restore/);
  assert.ok(h.state().applied?.secrets?.includes('in-falcone-postgresql'), 'restore must still apply backed-up Kubernetes Secrets');
  assert.deepEqual(h.state().helmRollbacks, [{ release: 'falcone', revision: '6' }], 'restore must still execute Helm rollback');
});

test('all-core KV restore skips captured target KV when OpenBao is unreachable after independent rollback', (t) => {
  const h = makeHarness(t, {
    target: { secret: { 'target/path': { token: 'TARGET_BACKUP_SECRET' } } },
    source: { secret: {} },
    kubernetes: makeKubernetesSecrets(),
  });
  const backup = join(h.root, 'unreachable-target-restore-backup.tgz');
  const baoEnv = {
    BAO_ADDR: 'https://target-openbao.test',
    BAO_TOKEN: 'target-token',
  };

  const backupRun = h.run('backup-kv.sh', ['--output', backup], baoEnv);
  assert.equal(backupRun.status, 0, `target KV backup must succeed\nstdout: ${backupRun.stdout}\nstderr: ${backupRun.stderr}`);

  const restoreRun = h.run('restore-kv.sh', ['--backup', backup, '--apply', '--helm-rollback'], {
    ...baoEnv,
    BAO_FAKE_STATUS_FAIL_CONTEXT: 'target',
  });
  assert.equal(restoreRun.status, 0, `restore must skip unreachable target KV after independent recovery\nstdout: ${restoreRun.stdout}\nstderr: ${restoreRun.stderr}`);
  assert.match(`${restoreRun.stdout}\n${restoreRun.stderr}`, /target OpenBao is not reachable; skipping OpenBao KV restore after Kubernetes\/Helm recovery/);
  assert.ok(h.state().applied?.secrets?.includes('in-falcone-postgresql'), 'restore must apply backed-up Kubernetes Secrets before target KV restore');
  assert.deepEqual(h.state().helmRollbacks, [{ release: 'falcone', revision: '6' }], 'restore must execute Helm rollback even when target OpenBao is unreachable');
});

test('all-core KV backup fails closed on target and source list/get errors', async (t) => {
  const cases = [
    { name: 'target list', env: { BAO_FAKE_LIST_FAIL_CONTEXT: 'target' }, source: false },
    {
      name: 'target get',
      env: { BAO_FAKE_EXPORT_GET_FAIL_CONTEXT: 'target', BAO_FAKE_EXPORT_GET_FAIL_PATH: 'target/path' },
      source: false,
    },
    { name: 'source list', env: { BAO_FAKE_LIST_FAIL_CONTEXT: 'source' }, source: true },
    {
      name: 'source get',
      env: { BAO_FAKE_EXPORT_GET_FAIL_CONTEXT: 'source', BAO_FAKE_EXPORT_GET_FAIL_PATH: 'source/path' },
      source: true,
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, (st) => {
      const h = makeHarness(st, {
        target: { secret: { 'target/path': { token: 'TARGET_BACKUP_SECRET' } } },
        source: { secret: { 'source/path': { token: 'SOURCE_BACKUP_SECRET' } } },
        kubernetes: makeKubernetesSecrets(),
      });
      const backup = join(h.root, `${testCase.name.replace(' ', '-')}.tgz`);
      const env = {
        BAO_ADDR: 'https://target-openbao.test',
        BAO_TOKEN: 'target-token',
        ...testCase.env,
      };
      if (testCase.source) {
        env.SOURCE_BAO_ADDR = 'https://source-openbao.test';
        env.SOURCE_BAO_TOKEN = 'source-token';
      }

      const result = h.run('backup-kv.sh', ['--output', backup], env);
      assert.notEqual(result.status, 0, `${testCase.name} failure must abort backup creation`);
      assert.match(`${result.stdout}\n${result.stderr}`, /refusing to record a partial tree/);
      assert.equal(existsSync(backup), false, `${testCase.name} failure must not publish a final backup archive`);
      assert.deepEqual(
        readdirSync(h.root).filter((name) => name.includes('.tgz.partial.')),
        [],
        `${testCase.name} failure must clean temporary backup archives`,
      );
    });
  }
});
