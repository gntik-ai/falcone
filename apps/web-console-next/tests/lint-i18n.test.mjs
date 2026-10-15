import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './run-cli.mjs';
import test from 'node:test';

async function lint(t, source, directory = false) {
  const root = mkdtempSync(join(tmpdir(), 'next-i18n-lint-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src'));
  const path = join(root, 'src', 'fixture.tsx');
  writeFileSync(path, source);
  return runCli(['scripts/lint-i18n.mjs', directory ? join(root, 'src') : path]);
}
for (const [name, source] of [
  ['JSX text', '<p>Untranslated text</p>'],
  ['aria-label', '<button aria-label="Untranslated" />'],
  ['title', '<div title="Untranslated" />'],
  ['placeholder', '<input placeholder="Untranslated" />'],
  ['expression text', '<p>{"Untranslated"}</p>'],
  ['expression attribute', '<input placeholder={"Untranslated"} />'],
  ['template text', '<p>{`Untranslated`}</p>']
]) test(`rejects ${name}`, async (t) => {
  const result = await lint(t, source);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /fixture.tsx:1:/);
});
test('translated JSX and non-copy attributes pass, including directory input', async (t) => {
  const result = await lint(t, `// <div title="comment" />\nconst example = '<p>documentation</p>';\nexport const Page = () => <main className="p-6" data-testid="page"><h1>{t('page.title')}</h1><input aria-label={t('page.label')} title={t('page.help')} placeholder={t('page.placeholder')} />{/* ignored comment */}</main>`, true);
  assert.equal(result.status, 0, result.stderr);
});
