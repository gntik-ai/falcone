import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// The pnpm overrides that patch brace-expansion must keep each minimatch major on a
// brace-expansion API it supports: minimatch 9 needs the 2.x line (a 5.x override broke
// its braceExpand), minimatch 10 uses 5.x.
function resolveChain(from, chain) {
  let requireFrom = createRequire(from);
  let resolved;
  for (const name of chain) {
    resolved = requireFrom.resolve(`${name}/package.json`);
    requireFrom = createRequire(resolved);
  }
  return { require: requireFrom, packageJson: requireFrom(resolved) };
}

const webConsole = fileURLToPath(new URL('../../apps/web-console/package.json', import.meta.url));

test('minimatch 9 (via glob 10) expands brace patterns with a patched brace-expansion 2.x', () => {
  const { require: fromMinimatch, packageJson } = resolveChain(webConsole, [
    '@vitest/coverage-v8',
    'test-exclude',
    'glob',
    'minimatch',
  ]);
  assert.equal(packageJson.version.split('.')[0], '9');
  const { minimatch } = fromMinimatch('minimatch');
  assert.deepEqual(minimatch.braceExpand('a{b,c}'), ['ab', 'ac']);
  assert.equal(minimatch('src/a.ts', 'src/*.{ts,tsx}'), true);
  const braceExpansion = fromMinimatch('brace-expansion/package.json');
  assert.equal(braceExpansion.version.split('.')[0], '2');
  const [major, minor, patch] = braceExpansion.version.split('.').map(Number);
  assert.ok(minor > 1 || (minor === 1 && patch >= 6), `brace-expansion ${braceExpansion.version} is unpatched`);
});
