import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

const script = resolve('scripts/validate-gntik-ui-pin.mjs');
const pins = {
  '@gntik-ai/ui': '0.9.0',
  '@gntik-ai/blocks': '0.9.0',
  '@gntik-ai/templates': '0.9.0',
  '@gntik-ai/tokens': '0.2.1',
};

async function validate(mutate = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'falcone-ui-pins-'));
  const manifest = { dependencies: { ...pins } };
  const dependencies = Object.fromEntries(Object.entries(pins).map(([name, version]) => [name, {
    specifier: version, version: `${version}(react@19.3.0)`,
  }]));
  const lockfile = { importers: { 'apps/web-console-next': { dependencies } } };
  mutate(manifest, lockfile);
  try {
    mkdirSync(join(root, 'apps/web-console-next'), { recursive: true });
    writeFileSync(join(root, 'apps/web-console-next/package.json'), JSON.stringify(manifest));
    writeFileSync(join(root, 'pnpm-lock.yaml'), YAML.stringify(lockfile));
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script, root]);
      let stderr = '';
      child.stdout.resume();
      child.stderr.setEncoding('utf8').on('data', (data) => { stderr += data; });
      child.on('error', reject);
      child.on('close', (status) => resolve({ status, stderr }));
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('the pin CLI accepts exact manifest and lockfile pins with peer suffixes', async () => {
  const result = await validate();
  assert.equal(result.status, 0, result.stderr);
});

test('the pin CLI rejects the previous 0.7.0 kit pins', async () => {
  const result = await validate((manifest, lock) => {
    for (const name of ['@gntik-ai/ui', '@gntik-ai/blocks', '@gntik-ai/templates']) {
      manifest.dependencies[name] = '0.7.0';
      lock.importers['apps/web-console-next'].dependencies[name] = {
        specifier: '0.7.0', version: '0.7.0(react@19.3.0)',
      };
    }
  });
  assert.equal(result.status, 1, result.stderr);
});

test('the pin CLI rejects the previous 0.5.0 kit pins', async () => {
  const result = await validate((manifest, lock) => {
    for (const name of ['@gntik-ai/ui', '@gntik-ai/blocks', '@gntik-ai/templates']) {
      manifest.dependencies[name] = '0.5.0';
      lock.importers['apps/web-console-next'].dependencies[name] = {
        specifier: '0.5.0', version: '0.5.0(react@19.3.0)',
      };
    }
  });
  assert.equal(result.status, 1, result.stderr);
});

test('the pin CLI rejects ranges, missing packages and mismatched lockfile pins', async () => {
  for (const mutate of [
    (manifest) => { manifest.dependencies['@gntik-ai/ui'] = '^0.9.0'; },
    (manifest) => { delete manifest.dependencies['@gntik-ai/blocks']; },
    (_, lock) => { delete lock.importers['apps/web-console-next'].dependencies['@gntik-ai/templates']; },
    (_, lock) => { lock.importers['apps/web-console-next'].dependencies['@gntik-ai/ui'].specifier = '^0.9.0'; },
    (_, lock) => { lock.importers['apps/web-console-next'].dependencies['@gntik-ai/tokens'].version = '0.2.0(react@19.3.0)'; },
  ]) {
    const result = await validate(mutate);
    assert.equal(result.status, 1, result.stderr);
  }
});

test('explicit UI tarballs must use the public npm registry', async () => {
  const publicPackage = (_, lock) => {
    lock.packages = { '@gntik-ai/ui@0.9.0': { resolution: {
      tarball: 'https://registry.npmjs.org/@gntik-ai/ui/-/ui-0.9.0.tgz',
    } } };
  };
  assert.equal((await validate(publicPackage)).status, 0);
  assert.equal((await validate((manifest, lock) => {
    publicPackage(manifest, lock);
    lock.packages['@gntik-ai/ui@0.9.0'].resolution.tarball = 'https://example.invalid/ui.tgz';
  })).status, 1);
});
