import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const consoleRoot = path.join(repoRoot, 'apps/web-console');
const require = createRequire(path.join(consoleRoot, 'package.json'));
const {build} = await import(pathToFileURL(require.resolve('vite')));

async function buildConsole(version, sha) {
  const directory = mkdtempSync(path.join(tmpdir(), 'console-version-'));
  const saved = [process.env.VITE_APP_VERSION, process.env.VITE_APP_COMMIT_SHA];
  for (const [name, value] of [['VITE_APP_VERSION', version], ['VITE_APP_COMMIT_SHA', sha]]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    // Use the production HTML and Vite configuration, with a tiny entry at the bundle seam.
    writeFileSync(path.join(directory, 'index.html'), readFileSync(path.join(consoleRoot, 'index.html'), 'utf8')
      .replace('/src/main.tsx', '/main.js'));
    writeFileSync(path.join(directory, 'main.js'), 'console.log(__APP_VERSION__, __APP_COMMIT_SHA__);');
    const result = await build({
      configFile: path.join(consoleRoot, 'vite.config.ts'),
      root: directory,
      logLevel: 'silent',
      build: {write: false, minify: false},
    });
    const outputs = result.output;
    return {
      html: outputs.find((item) => item.fileName === 'index.html').source,
      js: outputs.filter((item) => item.type === 'chunk').map((item) => item.code).join('\n'),
    };
  } finally {
    for (const [index, name] of ['VITE_APP_VERSION', 'VITE_APP_COMMIT_SHA'].entries()) {
      if (saved[index] === undefined) delete process.env[name];
      else process.env[name] = saved[index];
    }
    rmSync(directory, {recursive: true, force: true});
  }
}

test('release HTML carries the version before JS runs and the bundle carries the commit', async () => {
  const {html, js} = await buildConsole('1.2.3', '0123456789abcdef0123456789abcdef01234567');
  assert.match(html, /<meta name="version" content="1\.2\.3"/);
  assert.match(js, /"1\.2\.3"/);
  assert.match(js, /"0123456789abcdef0123456789abcdef01234567"/);
});

test('local builds default to dev and an empty commit', async () => {
  const {html, js} = await buildConsole();
  assert.match(html, /<meta name="version" content="dev"/);
  assert.match(js, /console\.log\("dev", ""\)/);
});

test('explicit dev and a seven-character lowercase commit are supported', async () => {
  const {html, js} = await buildConsole('dev', 'abcdef0');
  assert.match(html, /<meta name="version" content="dev"/);
  assert.match(js, /console\.log\("dev", "abcdef0"\)/);
});

test('invalid versions and commits never enter HTML or the bundle', async () => {
  for (const [version, sha] of [
    ['"><script>alert(1)</script>', '"><script>'],
    ['v1.2.3', 'ABCDEF0'],
    ['1.2.3-beta', 'abcdef'],
    ['1.2.3\n', 'abcdef0\n'],
  ]) {
    const {html, js} = await buildConsole(version, sha);
    assert.match(html, /<meta name="version" content="dev"/);
    assert.match(js, /console\.log\("dev", ""\)/);
    assert.ok(!html.includes(version));
    assert.ok(!js.includes(sha));
  }
});

test('the Docker builder supplies version and commit with safe local defaults', () => {
  const dockerfile = readFileSync(path.join(consoleRoot, 'Dockerfile'), 'utf8');
  const builder = dockerfile.split(/^FROM /m)[1];
  assert.match(builder, /^ARG APP_VERSION=dev$/m);
  assert.match(builder, /^ARG APP_COMMIT_SHA=$/m);
  assert.match(builder, /RUN .*VITE_APP_VERSION="\$APP_VERSION" VITE_APP_COMMIT_SHA="\$APP_COMMIT_SHA" .*vite build/);
});
