import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('../../apps/web-console-next/', import.meta.url));

test('next production builds validate version and SHA and inject them into HTML and the shell', async (t) => {
  const outDir = await mkdtemp(join(tmpdir(), 'next-version-build-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  for (const [version, sha, expectedVersion, expectedSha] of [
    ['1.2.3', '0123456789abcdef0123456789abcdef01234567', '1.2.3', '0123456789abcdef0123456789abcdef01234567'],
    ['4.5.6', 'abcdef0', '4.5.6', 'abcdef0'],
    ['<invalid-version>', 'not-a-sha', 'dev', '']
  ]) {
    const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', outDir, '--emptyOutDir'], {
      cwd: appRoot, env: { ...process.env, VITE_BASE_PATH: '/next/', VITE_APP_VERSION: version, VITE_APP_COMMIT_SHA: sha, CSP_TEST_HARNESS: '' }
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const status = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    assert.equal(status, 0, output);
    const html = await readFile(join(outDir, 'index.html'), 'utf8');
    assert.equal(html.match(/<meta name="version" content="([^"]*)"\s*\/>/)?.[1], expectedVersion);
    assert.match(html, /src="\/next\/assets\//);
    const assets = await readdir(join(outDir, 'assets'));
    let javascript = '';
    for (const asset of assets.filter((name) => name.endsWith('.js'))) javascript += await readFile(join(outDir, 'assets', asset), 'utf8');
    assert.ok(javascript.includes(`"${expectedVersion}"`), 'shell receives validated version');
    if (expectedSha) assert.ok(javascript.includes(`"${expectedSha}"`), 'shell receives the source commit');
    assert.ok(!javascript.includes('<invalid-version>'));
    assert.ok(!javascript.includes('not-a-sha'));
    await assert.rejects(readFile(join(outDir, 'tests/csp/index.html')), { code: 'ENOENT' });
  }
});
