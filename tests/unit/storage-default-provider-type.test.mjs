// DEFAULT_STORAGE_PROVIDER_TYPE is config-driven and evaluated at module import
// (services/adapters/src/storage-provider-profile.mjs). Because ESM caches modules,
// a same-process import cannot re-evaluate with a different env, so each assertion is
// verified by spawning a fresh child Node process that imports the real module and
// prints the resolved value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const moduleUrl = new URL('../../services/adapters/src/storage-provider-profile.mjs', import.meta.url).href;
const probe = `import { DEFAULT_STORAGE_PROVIDER_TYPE } from ${JSON.stringify(moduleUrl)}; process.stdout.write(DEFAULT_STORAGE_PROVIDER_TYPE);`;

function resolveDefaultProviderType(env) {
  return execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: repoRoot,
    env: { ...process.env, STORAGE_DEFAULT_PROVIDER_TYPE: undefined, ...env },
    encoding: 'utf8'
  }).trim();
}

test('DEFAULT_STORAGE_PROVIDER_TYPE resolves to seaweedfs when STORAGE_DEFAULT_PROVIDER_TYPE=seaweedfs', () => {
  assert.equal(resolveDefaultProviderType({ STORAGE_DEFAULT_PROVIDER_TYPE: 'seaweedfs' }), 'seaweedfs');
});

test('DEFAULT_STORAGE_PROVIDER_TYPE falls back to minio when STORAGE_DEFAULT_PROVIDER_TYPE is unset', () => {
  // Pass an env object whose STORAGE_DEFAULT_PROVIDER_TYPE is explicitly removed.
  const env = { ...process.env };
  delete env.STORAGE_DEFAULT_PROVIDER_TYPE;
  const value = execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: repoRoot,
    env,
    encoding: 'utf8'
  }).trim();
  assert.equal(value, 'minio');
});
