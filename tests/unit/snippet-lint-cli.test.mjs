import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, copyFileSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const pages = ['consoleFunctions', 'consolePostgres', 'consoleStorage'];

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'falcone-snippet-lint-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of [
    'scripts/lint-snippet-templates.mjs',
    'scripts/realtime-snippet-templates.data.mjs',
    'apps/web-console-next/package.json',
    ...['en', 'es'].map((locale) => `apps/web-console-next/src/locales/${locale}/pages.console-realtime-page.json`),
    ...pages.map((page) => `apps/web-console-next/src/pages/${page}/snippets.ts`),
  ]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(join(repository, file), join(root, file));
  }
  symlinkSync(join(repository, 'apps/web-console-next/node_modules'), join(root, 'apps/web-console-next/node_modules'), 'dir');
  return root;
}

function replaceSnippet(root, page, before, after) {
  const file = join(root, `apps/web-console-next/src/pages/${page}/snippets.ts`);
  const original = readFileSync(file, 'utf8');
  assert.ok(original.includes(before), `Fixture must change the ${page} snippet`);
  writeFileSync(file, original.replace(before, after));
}

function lint(directory = repository) {
  const output = mkdtempSync(join(tmpdir(), 'falcone-snippet-lint-output-'));
  const stdout = openSync(join(output, 'stdout'), 'w');
  const stderr = openSync(join(output, 'stderr'), 'w');
  try {
    const result = spawnSync(process.execPath, ['scripts/lint-snippet-templates.mjs'], {
      cwd: directory,
      stdio: ['ignore', stdout, stderr],
    });
    assert.ifError(result.error);
    return {
      status: result.status,
      stdout: readFileSync(join(output, 'stdout'), 'utf8'),
      stderr: readFileSync(join(output, 'stderr'), 'utf8'),
    };
  } finally {
    closeSync(stdout);
    closeSync(stderr);
    rmSync(output, { recursive: true, force: true });
  }
}

test('snippet lint validates the served console without the retired realtime guides', () => {
  const result = lint();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Realtime snippet templates validated successfully/);
});

for (const page of pages) {
  test(`snippet lint rejects invalid JavaScript in ${page}`, (t) => {
    const root = fixture(t);
    const variable = page === 'consoleFunctions' ? 'response' : 'client';
    replaceSnippet(root, page, `const ${variable} =`, `const ${variable} = ;`);
    const result = lint(root);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /SyntaxError: Unexpected token/);
    assert.doesNotMatch(result.stdout, /validated successfully/);
  });
}

test('snippet lint rejects credential-like tokens in served snippets', (t) => {
  const root = fixture(t);
  replaceSnippet(root, 'consoleFunctions', 'Bearer <API_TOKEN>', 'Bearer synthetic-placeholder-for-lint-test');
  const result = lint(root);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Embedded credential-like token in consoleFunctions/);
});

for (const locale of ['en', 'es']) {
  test(`snippet lint requires realtime snippet membership in ${locale}`, (t) => {
    const root = fixture(t);
    const file = join(root, `apps/web-console-next/src/locales/${locale}/pages.console-realtime-page.json`);
    const catalog = JSON.parse(readFileSync(file, 'utf8'));
    delete catalog.entries['realtime-js-browser-basic'];
    writeFileSync(file, JSON.stringify(catalog));
    const result = lint(root);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, new RegExp(`Catalog missing snippet id realtime-js-browser-basic in ${locale}`));
  });
}
