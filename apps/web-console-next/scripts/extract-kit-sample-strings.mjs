// Extracts the strings the kit's DataTable shows when it is rendered without `rows` (its built-in sample deployments)
// from the pinned @gntik-ai/blocks tarball, and compares or writes tests/parity/kit-sample-strings.json.
//
//   node scripts/extract-kit-sample-strings.mjs --check               download the tarball from public npm, verify
//                                                                    its recorded integrity, regenerate, and fail
//                                                                    unless the committed file is byte-identical
//   node scripts/extract-kit-sample-strings.mjs --write               same, then rewrite the committed file
//   node scripts/extract-kit-sample-strings.mjs --tarball <file> ...  use a local tarball (integrity still verified)
//   node scripts/extract-kit-sample-strings.mjs --package-dir <dir>   use an unpacked package (no integrity check)
//
// The version comes from package.json (the exact pin) and the integrity from the root pnpm-lock.yaml, so the file can
// never describe a different kit than the one the console builds against.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import ts from 'typescript';

export const KIT_PACKAGE = '@gntik-ai/blocks';
export const FIXTURE_PATH = 'src/tables/DataTable/fixtures.ts';
const appRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const OUTPUT = join(appRoot, 'tests/parity/kit-sample-strings.json');

// Backslashes first, then quotes: every occurrence is replaced, so no input can leave an unescaped one behind.
export const escapeForLog = (value) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export function integrityFromLock(lockText, name, version) {
  const lines = lockText.split('\n');
  const start = lines.findIndex((line) => line.trim() === `'${name}@${version}':`);
  if (start === -1) throw new Error(`${name}@${version} is not in pnpm-lock.yaml`);
  for (const line of lines.slice(start + 1, start + 4)) {
    const match = line.match(/integrity:\s*(sha512-[A-Za-z0-9+/=]+)/);
    if (match) return match[1];
  }
  throw new Error(`pnpm-lock.yaml has no integrity for ${name}@${version}`);
}

export function verifyIntegrity(tarball, integrity) {
  const [algorithm, expected] = [integrity.slice(0, integrity.indexOf('-')), integrity.slice(integrity.indexOf('-') + 1)];
  const actual = createHash(algorithm).update(tarball).digest('base64');
  if (actual !== expected) throw new Error(`tarball integrity mismatch: expected ${integrity}, got ${algorithm}-${actual}`);
}

// Minimal ustar reader: enough to pull one file out of an npm tarball without extracting anything to disk.
export function readTarEntry(tarGz, wanted) {
  const tar = gunzipSync(tarGz);
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
    const size = Number.parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8);
    const full = prefix ? `${prefix}/${name}` : name;
    if (full === wanted) return tar.subarray(offset + 512, offset + 512 + size).toString('utf8');
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${wanted} is not in the tarball`);
}

// Runs the kit's own fixture module (transpiled, with its two imports stubbed) and reads the rows it generates, so
// the extractor cannot drift from how the kit builds its sample rows.
export function sampleStringsFromFixture(source) {
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const stubs = { '@gntik-ai/ui': { StatusTag: () => null }, react: { createElement: () => null } };
  const module = { exports: {} };
  const require = (id) => {
    if (!(id in stubs)) throw new Error(`unexpected import in the kit fixture: ${id}`);
    return stubs[id];
  };
  vm.runInNewContext(outputText, { module, exports: module.exports, require, Intl, Date });
  const rows = module.exports.DEPLOYMENT_ROWS;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('the kit fixture exports no DEPLOYMENT_ROWS');
  // The strings a user sees in the default DataTable columns: the deployment name and its region.
  const strings = new Set();
  for (const row of rows) for (const key of ['name', 'region']) {
    if (typeof row[key] !== 'string' || !row[key]) throw new Error(`a kit sample row has no ${key}`);
    strings.add(row[key]);
  }
  return [...strings].sort();
}

export function render({ version, integrity, strings }) {
  return `${JSON.stringify({
    description: 'Strings the kit DataTable shows when rendered without rows. assertNoSampleData fails when a settled page shows one that no mocked response or user input supplied.',
    kit: { package: KIT_PACKAGE, version, integrity, source: `package/${FIXTURE_PATH}` },
    strings
  }, null, 2)}\n`;
}

async function pinnedKit() {
  const manifest = JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8'));
  const version = manifest.dependencies?.[KIT_PACKAGE];
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error(`${KIT_PACKAGE} must be pinned to an exact version in package.json`);
  const lock = await readFile(resolve(appRoot, '../../pnpm-lock.yaml'), 'utf8');
  return { version, integrity: integrityFromLock(lock, KIT_PACKAGE, version) };
}

async function loadSource({ version, integrity }, options) {
  if (options.packageDir) return readFile(join(options.packageDir, FIXTURE_PATH), 'utf8');
  let tarball;
  if (options.tarball) tarball = await readFile(options.tarball);
  else {
    const response = await fetch(`https://registry.npmjs.org/${KIT_PACKAGE}/-/${KIT_PACKAGE.split('/')[1]}-${version}.tgz`);
    if (!response.ok) throw new Error(`npm registry answered ${response.status}`);
    tarball = Buffer.from(await response.arrayBuffer());
  }
  verifyIntegrity(tarball, integrity);
  return readTarEntry(tarball, `package/${FIXTURE_PATH}`);
}

export async function main(argv = process.argv.slice(2)) {
  const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const pin = await pinnedKit();
  const generated = render({ ...pin, strings: sampleStringsFromFixture(await loadSource(pin, { tarball: option('--tarball'), packageDir: option('--package-dir') })) });
  if (argv.includes('--write')) {
    await writeFile(OUTPUT, generated);
    console.log(`wrote ${OUTPUT}`);
    return 0;
  }
  const committed = await readFile(OUTPUT, 'utf8');
  if (committed !== generated) {
    console.error('tests/parity/kit-sample-strings.json differs from the strings extracted from the pinned kit tarball');
    return 1;
  }
  console.log(`kit-sample-strings.json is byte-identical to ${KIT_PACKAGE}@${pin.version} (${pin.integrity})`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main().catch((error) => {
    console.error(escapeForLog(error.message));
    return 1;
  });
}
