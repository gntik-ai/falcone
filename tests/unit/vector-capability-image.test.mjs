// Check the public module-loading seam using the files each image actually ships.
// No container image, dependency installation or network is needed for this helper.
import test from 'node:test';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

for (const image of ['control-plane-executor', 'workflow-worker']) {
  test(`vector capability loads from the shipped ${image} image files`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'falcone-vector-image-'));
    try {
      const recipe = (await readFile(`apps/${image}/Dockerfile`, 'utf8')).replace(/\\\n\s*/g, ' ');
      for (const line of recipe.split('\n')) {
        const match = /^COPY (.+) (\/app\/\S+)$/.exec(line);
        if (!match || match[1].startsWith('--')) continue;
        for (const source of match[1].trim().split(/\s+/)) {
          const destination = join(root, match[2].slice('/app/'.length), match[2].endsWith('/') ? basename(source) : '');
          await mkdir(dirname(destination), { recursive: true });
          await cp(source, destination, { recursive: true });
        }
      }
      await import(pathToFileURL(join(root, 'apps/control-plane-executor/src/runtime/vector-capability.mjs')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
