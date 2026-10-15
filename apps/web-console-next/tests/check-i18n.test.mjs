import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './run-cli.mjs';
import test from 'node:test';

async function fixture(t, es, en, route = "const page = lazyPage('account', () => import('./account'))", mutate = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'next-i18n-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [locale, resource] of [['es', es], ['en', en]]) {
    mkdirSync(join(root, 'locales', locale), { recursive: true });
    writeFileSync(join(root, 'locales', locale, 'account.json'), JSON.stringify(resource));
    writeFileSync(join(root, 'locales', locale, 'common.json'), '{}');
  }
  mkdirSync(join(root, 'routes'));
  writeFileSync(join(root, 'routes', 'router.tsx'), route);
  mutate(root);
  return runCli(['scripts/check-i18n.mjs', join(root, 'locales'), join(root, 'routes')]);
}

test('matching nested keys pass with translated values', async (t) => {
  const result = await fixture(t, { page: { title: 'Cuenta' } }, { page: { title: 'Account' } });
  assert.equal(result.status, 0, result.stderr);
});
for (const missing of ['es', 'en']) test(`a key missing in ${missing} fails`, async (t) => {
  const result = await fixture(t, missing === 'es' ? {} : { title: 'Cuenta' }, missing === 'en' ? {} : { title: 'Account' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /account.*title/);
});
test('route namespace missing in both locales fails', async (t) => {
  const result = await fixture(t, {}, {}, "const page = lazyPage('missing', () => import('./page'))");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing/);
});
test('translation hook namespaces in route files are checked too', async (t) => {
  const result = await fixture(t, {}, {}, "useTranslation(['account', 'missing'])");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing/);
});
test('an entire namespace absent from one locale fails', async (t) => {
  const result = await fixture(t, { title: 'Cuenta' }, { title: 'Account' }, undefined, (root) => {
    rmSync(join(root, 'locales', 'en', 'account.json'));
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /account/);
});
