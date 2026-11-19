import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const docker = (args) => spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const available = docker(['info']).status === 0;
test('the real Docker build context includes the next dist', { skip: !available && 'Docker unavailable; PR CI builds the context' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'cutover-context-'));
  const marker = `cutover-context-${process.pid}.txt`, image = `falcone-context-test:${process.pid}`;
  mkdirSync('apps/web-console-next/dist', { recursive: true });
  const probe = `apps/web-console-next/dist/${marker}`;
  try {
    writeFileSync(probe, 'next context');
    const file = join(dir, 'Dockerfile');
    writeFileSync(file, `FROM scratch\nCOPY ${probe} /included\n`);
    const result = docker(['build', '--network=none', '-f', file, '-t', image, '.']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally { docker(['image', 'rm', image]); rmSync(probe, { force: true }); rmSync(dir, { recursive: true, force: true }); }
});
test('the cutover image has only next assets, release metadata and UID 1000 on a read-only root', { skip: (!available || !process.env.CUTOVER_IMAGE) && 'Docker or CUTOVER_IMAGE unavailable; PR CI tests the image' }, () => {
  const result = docker(['run', '--rm', '--read-only', '--network=none', '--entrypoint=node', process.env.CUTOVER_IMAGE, '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
    assert.equal(process.getuid(), 1000);
    assert.deepEqual(readdirSync('/app').sort(), ['dist', 'static-server.mjs']);
    assert.ok(!existsSync('/app/dist-next') && !existsSync('/app/.npmrc'));
    assert.throws(() => writeFileSync('/app/write-probe', 'test'), (e) => ['EROFS', 'EACCES'].includes(e.code));
    assert.ok(!Object.keys(process.env).some((key) => /TOKEN|PASSWORD|NPM_AUTH/i.test(key)));
    const html = readFileSync('/app/dist/index.html', 'utf8');
    assert.match(html, /<meta name="version" content="1.2.3"/);
    assert.match(html, /src="\\/assets\\//);
    const javascript = readdirSync('/app/dist/assets').filter((p) => p.endsWith('.js')).map((p) => readFileSync('/app/dist/assets/' + p, 'utf8')).join('');
    assert.ok(javascript.includes('0123456789abcdef0123456789abcdef01234567'));
    assert.ok(!javascript.includes('ghp_') && !javascript.includes('github_pat_'));
  `]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
