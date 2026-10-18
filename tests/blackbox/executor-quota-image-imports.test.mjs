import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
test('executor image ships the entire static quota evaluator import graph', async () => {
  const dockerfile = await readFile(path.join(root, 'apps/control-plane-executor/Dockerfile'), 'utf8');
  const copies = [...dockerfile.matchAll(/^COPY\s+(\S+)\s+(\/app\/\S+)\s*$/gm)].map(([, source, destination]) => ({ source, destination }));
  const seen = new Set();
  async function walk(file) {
    if (seen.has(file)) return;
    seen.add(file);
    const relative = path.relative(root, file);
    assert.ok(!relative.startsWith('..'), `import stays in repository: ${relative}`);
    assert.ok(copies.some(({ source, destination }) => (relative === source || relative.startsWith(`${source}/`)) && destination === `/app/${source}`), `Dockerfile must COPY ${relative} at its import path`);
    const code = await readFile(file, 'utf8');
    assert.doesNotMatch(code, /\bimport\s*\(/, `no dynamic imports in ${relative}`);
    for (const [, specifier] of code.matchAll(/^\s*(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/gm)) {
      if (specifier === 'node:crypto') continue;
      assert.ok(specifier.startsWith('.'), `only relative imports or node:crypto: ${relative}: ${specifier}`);
      await walk(path.resolve(path.dirname(file), specifier));
    }
  }
  await walk(path.join(root, 'apps/control-plane-executor/src/runtime/flow-quota-evaluator.mjs'));
});
