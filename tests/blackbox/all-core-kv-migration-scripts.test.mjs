import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  if (entries.size === 0) process.exit(2);
  console.log(JSON.stringify([...entries].sort()));
}
function kvGet(ref) {
  const [mount, path] = splitRef(ref);
  const value = storeFor(mount)[path];
  if (!value) process.exit(2);
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
if (args.includes('apply')) process.exit(0);
const getIndex = args.indexOf('get');
if (getIndex === -1) process.exit(2);
const resource = args[getIndex + 1];
const name = args[getIndex + 2] && !args[getIndex + 2].startsWith('-') ? args[getIndex + 2] : '';
if (resource === 'secret' && name) {
  print(secretObject(name, state.kubernetes?.[name]));
  process.exit(0);
}
if (resource === 'secrets') {
  print({ apiVersion: 'v1', kind: 'SecretList', items: Object.entries(state.kubernetes || {}).map(([n, d]) => secretObject(n, d)) });
  process.exit(0);
}
print({ apiVersion: 'v1', kind: 'List', items: [] });
`);

  writeExecutable(join(bin, 'helm'), `#!/usr/bin/env node
const args = process.argv.slice(2);
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
if (args.includes('rollback')) process.exit(0);
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

test('all-core KV migration refuses overwrite when backup did not capture target KV', (t) => {
  const h = makeHarness(t, {
    target: {
      secret: {
        'platform/postgresql': { username: 'TARGET_OLD_USERNAME' },
      },
    },
    source: { secret: {} },
    kubernetes: makeKubernetesSecrets({
      'in-falcone-postgresql/POSTGRESQL_USERNAME': 'K8S_USERNAME',
    }),
  });
  const backup = join(h.root, 'no-target-backup.tgz');
  const backupRun = h.run('backup-kv.sh', ['--output', backup], {});
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
