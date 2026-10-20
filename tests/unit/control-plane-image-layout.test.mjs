import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, cp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('control-plane image layout mirrors Dockerfile /repo COPY destinations and imports workspace operator scripts', async () => {
  const root = resolve(import.meta.dirname, '../..');
  const layout = await mkdtemp(join(tmpdir(), 'falcone-image-layout-'));
  try {
    const dockerfile = (await readFile(join(root, 'apps/control-plane/Dockerfile'), 'utf8')).replace(/\\\n/g, ' ');
    for (const match of dockerfile.matchAll(/^COPY\s+(.+)$/gm)) {
      const parts = match[1].trim().split(/\s+/);
      const destination = parts.pop();
      if (!destination.startsWith('/repo/')) continue;
      assert.equal(parts.length, 1, 'use explicit /repo COPY entries');
      const target = join(layout, destination);
      await mkdir(dirname(target), { recursive: true });
      await cp(join(root, parts[0]), target, { recursive: true });
    }
    for (const [script, exported] of [
      ['backfill-workspace-service-accounts.mjs', 'runBackfill'],
      ['rollback-workspace-service-accounts.mjs', 'runRollback'],
      ['rebind-workspace-user.mjs', 'runRebind'],
    ]) {
      const module = await import(pathToFileURL(join(layout, 'repo/scripts', script)).href);
      assert.equal(typeof module[exported], 'function');
    }
  } finally { await rm(layout, { recursive: true, force: true }); }
});
