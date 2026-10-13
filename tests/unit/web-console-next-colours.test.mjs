import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const script = resolve('apps/web-console-next/scripts/lint-colours.mjs');

function lint(paths) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...paths]);
    child.stdout.resume();
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', resolve);
  });
}

test('the colour CLI accepts the scaffold and semantic tokens, but rejects literal colours', async () => {
  assert.equal(await lint([]), 0);
  const root = mkdtempSync(join(tmpdir(), 'falcone-colours-'));
  try {
    const fixture = join(root, 'fixture.tsx');
    writeFileSync(fixture, '<p className="bg-background text-foreground">Falcone</p>');
    assert.equal(await lint([fixture]), 0);
    writeFileSync(fixture, '<p style={{ color: "#aabbcc" }}>Falcone</p>');
    assert.equal(await lint([fixture]), 1);
    writeFileSync(fixture, '<p className="hover:bg-red-500">Falcone</p>');
    assert.equal(await lint([fixture]), 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
