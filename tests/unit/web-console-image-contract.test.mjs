import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const script = join(repoRoot, 'scripts/release/verify-web-console-image.sh');
const SHA = '0123456789abcdef0123456789abcdef01234567';

// Only the docker CLI is faked: the filesystem it "exports" is a fixture tree, and `docker run` hands back the
// port of the real static-server.mjs serving that tree, so the read-only runtime check is a real HTTP exchange.
function dockerStub(directory) {
  const path = join(directory, 'docker');
  writeFileSync(path, `#!/usr/bin/env bash
case "$1" in
  create) echo fixture-container ;;
  inspect) echo "$FAKE_USER" ;;
  export) tar -c -C "$FAKE_FS" app ;;
  cp) cp -r "$FAKE_FS/app" "$3" ;;
  run) echo fixture-runner ;;
  port) echo "0.0.0.0:$FAKE_PORT" ;;
  rm) exit 0 ;;
  *) echo "unexpected docker $1" >&2; exit 1 ;;
esac
`);
  chmodSync(path, 0o755);
}

function buildFilesystem(directory, { version = '1.2.3', sha = SHA, extra = {} } = {}) {
  const fs = join(directory, 'fs');
  mkdirSync(join(fs, 'app/dist/assets'), { recursive: true });
  writeFileSync(join(fs, 'app/static-server.mjs'), readStaticServer());
  writeFileSync(join(fs, 'app/dist/index.html'), `<!doctype html><meta name="version" content="${version}" /><main>Next console</main>`);
  writeFileSync(join(fs, 'app/dist/assets/app.abc123.js'), `window.__sha = "${sha}";`);
  for (const [name, body] of Object.entries(extra)) {
    mkdirSync(dirname(join(fs, name)), { recursive: true });
    writeFileSync(join(fs, name), body);
  }
  return fs;
}

function readStaticServer() {
  return readFileSync(join(repoRoot, 'apps/web-console/static-server.mjs'), 'utf8');
}

async function startServer(root) {
  const child = spawn(process.execPath, [join(root, '../static-server.mjs')], {
    env: { ...process.env, PORT: '0', WEB_CONSOLE_STATIC_ROOT: root }, stdio: ['ignore', 'pipe', 'inherit']
  });
  let out = '';
  for await (const chunk of child.stdout) {
    out += chunk;
    const match = out.match(/:(\d+)/);
    if (match) return { child, port: match[1] };
  }
  throw new Error('static server did not start');
}

async function verify(t, { user = '1000', ...options } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'console-image-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  dockerStub(directory);
  const fs = buildFilesystem(directory, options);
  const server = await startServer(join(fs, 'app/dist'));
  t.after(async () => { server.child.kill('SIGTERM'); await once(server.child, 'exit'); });
  const result = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, IMAGE_REF: 'registry/image@sha256:matching', VERSION: '1.2.3',
      COMMIT_SHA: SHA, FAKE_USER: user, FAKE_FS: fs, FAKE_PORT: server.port }
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

test('a next-only image running as UID 1000 on a read-only root passes the contract', async (t) => {
  const result = await verify(t);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /web-console image contract verified/);
});

for (const [name, options, symptom] of [
  ['root user', { user: '0' }, /UID 1000/],
  ['empty user', { user: '' }, /UID 1000/],
  ['a legacy-style second bundle', { extra: { 'app/dist-next/index.html': '<html></html>' } }, /only dist and static-server\.mjs/],
  ['an .npmrc', { extra: { 'app/.npmrc': '//npm.pkg.github.com/:_authToken=<REDACTED>' } }, /\.npmrc|only dist/],
  ['a registry token in the bundle', { extra: { 'app/dist/assets/leak.js': 'const t = "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";' } }, /registry token/],
  ['the dev version', { version: 'dev' }, /release version 1\.2\.3/],
  ['a bundle without the source commit', { sha: 'ffffffffffffffffffffffffffffffffffffffff' }, /source commit/],
]) {
  test(`the image contract fails for ${name}`, async (t) => {
    const result = await verify(t, options);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /::error::/);
    assert.match(result.output, symptom);
  });
}
