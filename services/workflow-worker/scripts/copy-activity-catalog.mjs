// Build step: copy the native-ESM activity catalog (.mjs) into dist/ alongside the
// tsc-emitted CommonJS bundle (change: add-flows-activity-catalog / #360).
//
// The activity catalog is authored as .mjs ESM (see src/activities/index.ts header for
// why); tsc only emits .ts → .js, so the .mjs modules must be copied verbatim. The CJS
// `dist/activities/index.js` loads them at runtime via a genuine dynamic `import()`.
import { cpSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '..', 'src', 'activities');
const distDir = resolve(here, '..', 'dist', 'activities');

let count = 0;
for (const name of readdirSync(srcDir)) {
  if (!name.endsWith('.mjs')) continue;
  cpSync(resolve(srcDir, name), resolve(distDir, name));
  count += 1;
}
// eslint-disable-next-line no-console
console.log(`[copy-activity-catalog] copied ${count} .mjs module(s) into dist/activities/`);
