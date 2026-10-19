import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
const dist = new URL('../dist/', import.meta.url);
test('a release build includes no shell fixture route or chunk', () => {
  const manifest = readFileSync(new URL('.vite/manifest.json', dist), 'utf8');
  assert.doesNotMatch(manifest, /FixtureRoutes|LazyDestination|__fixture/);
  for (const file of readdirSync(new URL('assets/', dist)).filter((name) => name.endsWith('.js'))) {
    assert.doesNotMatch(readFileSync(new URL(`assets/${file}`, dist), 'utf8'), /__fixture|synthetic-render-failure/);
  }
});
