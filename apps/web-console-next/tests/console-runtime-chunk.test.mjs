import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dist = new URL('../dist/', import.meta.url);
test('runtime and both locale catalogs stay in a separate lazy chunk', () => {
  const manifest = JSON.parse(readFileSync(new URL('.vite/manifest.json', dist), 'utf8'));
  const runtime = 'src/pages/consoleRuntime.tsx';
  assert.ok(manifest[runtime]?.isDynamicEntry);
  const eager = new Set();
  function visit(key) {
    if (eager.has(key)) return;
    eager.add(key);
    for (const dependency of manifest[key].imports ?? []) visit(dependency);
  }
  visit('index.html');
  assert.ok(!eager.has(runtime));
  const page = readFileSync(new URL(manifest[runtime].file, dist), 'utf8');
  for (const title of ['Runtime de funciones', 'Functions runtime']) assert.ok(page.includes(title));
  for (const key of eager) {
    const code = readFileSync(new URL(manifest[key].file, dist), 'utf8');
    assert.ok(!code.includes('Estado actualizado: {state}.'));
    assert.ok(!code.includes('Status updated: {state}.'));
  }
});
