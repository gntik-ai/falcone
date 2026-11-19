// Regenerates tests/parity/kit-sample-strings.json: the sample rows the kit DataTable shows when a page forgets its
// `rows` prop (DEPLOYMENT_ROWS in @gntik-ai/blocks). tests/parity/checks.mjs `assertNoSampleData` fails a page that shows
// any of them.
//
//   node scripts/extract-kit-sample-strings.mjs --package <extracted package dir> [--out <file> | --check]
//   node scripts/extract-kit-sample-strings.mjs --tarball <npm pack output> [--out <file> | --check]
//
// --tarball (CI, public npm: `npm pack @gntik-ai/blocks@<pin>`) first verifies the tarball integrity against the one
// pnpm-lock.yaml records for the pinned version, then extracts it into a fresh directory. The package source is read
// as text and only its data section is evaluated, so the extraction needs no installed dependencies.
// --check fails unless the regenerated file is byte-identical to the committed one.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(appRoot, '../..');
const committed = join(appRoot, 'tests/parity/kit-sample-strings.json');
const PACKAGE = '@gntik-ai/blocks';

function lockIntegrity(version) {
  const lock = readFileSync(join(repoRoot, 'pnpm-lock.yaml'), 'utf8');
  const match = lock.match(new RegExp(`^  '${PACKAGE}@${version.replace(/\./g, '\\.')}':\\n    resolution: \\{integrity: (sha512-[^,}]+)`, 'm'));
  if (!match) throw new Error(`pnpm-lock.yaml records no integrity for ${PACKAGE}@${version}`);
  return match[1];
}

export function extract(packageDir) {
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  if (manifest.name !== PACKAGE) throw new Error(`expected ${PACKAGE}, found ${manifest.name}`);
  const source = readFileSync(join(packageDir, 'dist/index.js'), 'utf8');
  const start = source.indexOf('const NAMES = [');
  const endMarker = 'const DEPLOYMENT_ROWS = generateDeployments(24);';
  const end = source.indexOf(endMarker);
  if (start < 0 || end < start) throw new Error('the DataTable sample rows were not found in dist/index.js: the kit changed shape');
  const rows = vm.runInNewContext(`${source.slice(start, end + endMarker.length)}\nDEPLOYMENT_ROWS`, { Date, Math }, { timeout: 5000 });
  // A row is identified by its name and region cells, which the table renders next to each other. Names alone would
  // collide with real function and resource names.
  const strings = rows.map((row) => `${row.name} ${row.region}`);
  if (strings.length !== 24 || new Set(strings).size !== strings.length) throw new Error('unexpected sample rows');
  const document = {
    source: { package: PACKAGE, version: manifest.version, integrity: lockIntegrity(manifest.version), shown: 'DataTable default rows: name and region cells, in row order' },
    strings
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

function parse(argv) {
  const args = { check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--check') args.check = true;
    else if (['--package', '--tarball', '--out'].includes(flag)) args[flag.slice(2)] = resolve(argv[++index] ?? '');
    else throw new Error(`unknown argument ${flag}`);
  }
  if (!args.package === !args.tarball) throw new Error('give exactly one of --package or --tarball');
  return args;
}

export function main(argv) {
  const args = parse(argv);
  let directory = args.package;
  let scratch;
  try {
    if (args.tarball) {
      scratch = mkdtempSync(join(tmpdir(), 'kit-sample-strings-'));
      const integrity = `sha512-${createHash('sha512').update(readFileSync(args.tarball)).digest('base64')}`;
      const version = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')).dependencies[PACKAGE];
      if (integrity !== lockIntegrity(version)) throw new Error(`the tarball integrity ${integrity} differs from the pnpm-lock.yaml integrity of ${PACKAGE}@${version}`);
      const untar = spawnSync('tar', ['-xzf', args.tarball, '-C', scratch], { encoding: 'utf8' });
      if (untar.status !== 0) throw new Error(`tar failed: ${untar.stderr}`);
      directory = join(scratch, 'package');
    }
    const generated = extract(directory);
    if (args.check) {
      if (generated !== readFileSync(committed, 'utf8')) throw new Error('tests/parity/kit-sample-strings.json is not byte-identical to the strings extracted from the package');
      console.log('kit-sample-strings.json is byte-identical to the strings extracted from the package');
    } else writeFileSync(args.out ?? committed, generated);
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(`extract-kit-sample-strings: ${error.message}`); process.exitCode = 1; }
}
