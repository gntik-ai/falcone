import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const app = new URL('../../', import.meta.url);
const lock = await readFile(new URL('../../pnpm-lock.yaml', app), 'utf8');
const pins = JSON.parse(await readFile(new URL('package.json', app), 'utf8')).dependencies;
const packages = {};
for (const name of ['@gntik-ai/ui', '@gntik-ai/blocks']) {
  const version = pins[name];
  const installed = JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`, app), 'utf8'));
  if (installed.version !== version) throw new Error(`${name}: installed version differs from pin`);
  const integrity = lock.split(`'${name}@${version}':`)[1]?.match(/integrity: ([^}\s]+)/)?.[1];
  if (!integrity) throw new Error(`${name}: missing lockfile tarball integrity`);
  packages[name] = { version, integrity };
}
const blocks = await readFile(new URL('node_modules/@gntik-ai/blocks/dist/index.js', app), 'utf8');
const section = blocks.split('//#region src/tables/DataTable/fixtures.ts')[1]?.split('const money =')[0];
if (!section?.includes('const DEPLOYMENT_ROWS =')) throw new Error('DataTable fixture format changed; review sample extraction');
const rows = runInNewContext(`${section}\nDEPLOYMENT_ROWS;`, {}, { timeout: 1000 });
const ui = await readFile(new URL('node_modules/@gntik-ai/ui/dist/i18n/messages/textarea-messages.js', app), 'utf8');
const sampleLines = [...ui.matchAll(/"textarea.sampleLine":\s*("(?:[^"\\]|\\.)*")/g)].map((m) => JSON.parse(m[1]));
if (rows.length !== 24 || sampleLines.length !== 2) throw new Error('Kit fixture coverage changed');
const strings = [...new Set([...rows.flatMap((row) => [row.id, row.name]), ...sampleLines])].sort();
const evidence = {
  packages,
  sourceSha256: createHash('sha256').update(section).update(ui).digest('hex'),
  extraction: 'DataTable default DEPLOYMENT_ROWS id/name in blocks, and textarea.sampleLine in ui, es/en. Generic status and region vocabulary is excluded because it can be real backend data. Sources are the locally installed packages authenticated by the committed lockfile integrity; no network is used.',
  strings,
};
const output = new URL('./kit-sample-strings.json', import.meta.url);
const bytes = JSON.stringify(evidence, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (await readFile(output, 'utf8') !== bytes) throw new Error('kit-sample-strings.json differs from the pinned kit');
  console.log(`${strings.length} kit sample strings match the pinned packages`);
} else await writeFile(output, bytes);
