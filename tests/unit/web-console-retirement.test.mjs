import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

test('the retired console is absent and the served console owns its runtime configuration', () => {
  assert.equal(existsSync('apps/web-console'), false);
  for (const file of ['Dockerfile', 'static-server.mjs', 'nginx.conf']) {
    assert.equal(existsSync(`apps/web-console-next/${file}`), true, file);
  }
});

test('runtime consumers no longer reference the retired console root', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const retired = /(?:\.\.\/|apps\/)web-console\//;
  function check(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'test-results', 'playwright-report'].includes(entry.name)) continue;
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) check(file);
      else if (/\.(?:[cm]?[jt]sx?|json)$/.test(entry.name)) {
        const source = readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '');
        assert.doesNotMatch(source, retired, file);
      }
    }
  }
  for (const directory of ['apps/web-console-next', 'tests', 'scripts', 'packages']) check(directory);
});
