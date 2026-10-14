import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const validator = fileURLToPath(new URL('../scripts/validate-dist.mjs', import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`./fixtures/csp/${name}`, import.meta.url));
async function validate(name) {
  const output = mkdtempSync(join(tmpdir(), 'validate-dist-'));
  const stdout = join(output, 'stdout'), stderr = join(output, 'stderr');
  const out = openSync(stdout, 'w'), err = openSync(stderr, 'w');
  try {
    const status = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [validator, fixture(name)], { stdio: ['ignore', out, err] });
      child.on('error', reject);
      child.on('close', resolve);
    });
    return { status, stdout: readFileSync(stdout, 'utf8'), stderr: readFileSync(stderr, 'utf8') };
  } finally {
    closeSync(out); closeSync(err);
    rmSync(output, { recursive: true, force: true });
  }
}

test('inline script bodies are rejected with the file and offending content', async () => {
  const result = await validate('inline-script');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /index\.html.*inline script.*window\.theme/);
});

for (const [name, url] of [
  ['remote-stylesheet', 'https://fonts.googleapis.com/css2?family=Geist'],
  ['remote-script', 'https://cdn.example/app.js'],
  ['remote-link', '//cdn.example/font.woff2'],
  ['no-src', '<script>'],
  ['body-with-src', 'inline script body'],
]) test(`${name} is rejected with its file and offending URL or content`, async () => {
  const result = await validate(name);
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes('index.html'), result.stderr);
  assert.ok(result.stderr.includes(url), result.stderr);
});

test('missing index.html cannot silently pass', async () => {
  const result = await validate('missing');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /index\.html.*cannot read/);
});

for (const [name, url] of [
  ['css-import', 'https://fonts.example/geist.css'],
  ['css-font', '//cdn.example/geist.woff2'],
  ['css-string-import', 'http://fonts.example/geist.css'],
]) test(`${name} in nested CSS is rejected with its file and URL`, async () => {
  const result = await validate(name);
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes('nested/font.css'), result.stderr);
  assert.ok(result.stderr.includes(url), result.stderr);
});

test('a local build reports both self-hosted font families', async () => {
  const result = await validate('local');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Geist Sans woff2: 1/);
  assert.match(result.stdout, /Geist Mono woff2: 1/);
});

test('a build without either font family is rejected', async () => {
  const result = await validate('missing-fonts');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /assets.*Geist Sans/);
  assert.match(result.stderr, /assets.*Geist Mono/);
});

test('HTML comments inside an external script still count as an inline body', async () => {
  const result = await validate('comment-script');
  assert.match(result.stderr, /index\.html.*inline script body/);
});

test('a quoted CSS import without whitespace is still a remote target', async () => {
  const result = await validate('compact-import');
  assert.match(result.stderr, /font\.css.*https:\/\/fonts\.example\/compact\.css/);
});
