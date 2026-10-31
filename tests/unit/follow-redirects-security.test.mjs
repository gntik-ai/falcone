import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const consumers = [
  ['documentation', '../../docs-site/package.json', ['vitepress', '@vueuse/integrations', 'axios', 'follow-redirects']],
  ['hardening', '../hardening/package.json', ['node-vault', 'axios', 'follow-redirects']],
];

for (const [name, manifest, chain] of consumers) {
  test(`${name} resolves follow-redirects patched for GHSA-mrwp-f3q8-3g9p`, () => {
    let requireFrom = createRequire(new URL(manifest, import.meta.url));
    let dependency;
    for (const packageName of chain) {
      const resolved = requireFrom.resolve(`${packageName}/package.json`);
      dependency = requireFrom(resolved);
      requireFrom = createRequire(resolved);
    }
    // The advisory identifies 1.16.2 as the first patched release.
    const [major, minor, patch] = dependency.version.split('.').map(Number);
    assert.ok(major > 1 || (major === 1 && (minor > 16 || (minor === 16 && patch >= 2))),
      `${name} resolves unpatched follow-redirects ${dependency.version}`);
  });
}
