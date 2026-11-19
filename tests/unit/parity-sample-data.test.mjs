import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runCli } from '../../apps/web-console-next/tests/run-cli.mjs';
import { assertNoSampleData } from '../../apps/web-console-next/tests/parity/checks.mjs';
import { bindSampleDataGuard, expect, guardActions, unbindSampleDataGuard } from '../../apps/web-console-next/tests/parity/sample-data-guard.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../apps/web-console-next');
const sampleStrings = JSON.parse(readFileSync(join(appRoot, 'tests/parity/kit-sample-strings.json'), 'utf8')).strings;
const RULE = 'parity/no-implicit-sample-data';

// --- parity:validate, parity/no-implicit-sample-data, driven through its CLI ---

function validate(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'parity-sample-data-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pages = join(dir, 'pages');
  const src = join(dir, 'src');
  mkdirSync(pages);
  mkdirSync(src);
  const checks = ['data', 'action', 'error-empty', 'accessibility', 'runtime-health', 'responsive', 'visual-review', 'kit-conformance'];
  writeFileSync(join(pages, 'overview.manifest.ts'), 'export default {}');
  writeFileSync(join(pages, 'overview.spec.mjs'), checks.map((name) => `test('${name}', async () => { await check(); });`).join('\n'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(src, name), `import { DataTable } from '@gntik-ai/blocks'\n${body}\n`);
  return runCli(['tests/parity/validate.mjs', pages, '--src', src]);
}

const positives = {
  'a rows attribute': 'export const A = () => <DataTable rows={items} columns={columns} />',
  'rows after a spread': 'export const A = ({ rest }) => <DataTable {...rest} rows={items} />',
  'a const object literal with rows': 'export function A({ items }) { const shared = { rows: items, columns }; return <DataTable {...shared} paginated={false} /> }',
  'a shorthand rows in a const literal spread twice': 'export function A({ rows }) { const shared = { rows, columns }; return <>{a ? <DataTable {...shared} /> : <DataTable {...shared} selectable={false} />}</> }',
  'an inline literal': 'export const A = ({ items }) => <DataTable {...{ rows: items }} />',
  'property reads of the literal': 'export function A({ items }) { const shared = { rows: items }; const n = shared.rows.length; return <DataTable {...shared} aria-label={String(n)} /> }',
  'a neutral literal followed by rows': 'export const A = () => <DataTable {...{ columns }} rows={items} />',
  'an aliased kit import': 'export const A = () => <Table rows={items} />',
  'a namespace import': 'export const A = () => <Kit.DataTable rows={items} />',
  'no DataTable at all': 'export const A = () => <table />',
};
for (const [name, body] of Object.entries(positives)) {
  test(`parity:validate passes a fixture with ${name}`, async (t) => {
    const prefix = name === 'an aliased kit import' ? "import { DataTable as Table } from '@gntik-ai/blocks'\n" : name === 'a namespace import' ? "import * as Kit from '@gntik-ai/blocks'\n" : '';
    const result = await validate(t, { 'fixture.tsx': `${prefix}${body}` });
    assert.equal(result.status, 0, result.stderr);
  });
}

const negatives = {
  'missing rows': 'export const A = () => <DataTable columns={columns} />',
  'rows without a value': 'export const A = () => <DataTable rows columns={columns} />',
  'rows undefined': 'export const A = () => <DataTable rows={undefined} />',
  'rows null': 'export const A = () => <DataTable rows={null} />',
  'a const literal without rows': 'export function A() { const shared = { columns }; return <DataTable {...shared} /> }',
  'a literal that sets rows to undefined': 'export function A() { const shared = { rows: undefined }; return <DataTable {...shared} /> }',
  'shadowing by a parameter': 'const shared = { rows: [] }\nexport function A({ shared }) { return <DataTable {...shared} /> }',
  'shadowing by a nested const without rows': 'const shared = { rows: [] }\nexport function A() { const shared = { columns }; return <DataTable {...shared} /> }',
  'a parameter with a default': 'export function A({ shared = { rows: [] } }) { return <DataTable {...shared} /> }',
  'reassignment of a let': 'export function A() { let shared = { rows: [] }; shared = {}; return <DataTable {...shared} /> }',
  'mutation of a const literal': 'export function A() { const shared = { rows: items }; shared.rows = undefined; return <DataTable {...shared} /> }',
  'deletion of rows': 'export function A() { const shared = { rows: items }; delete shared.rows; return <DataTable {...shared} /> }',
  'a mutating call': 'export function A() { const shared = { rows: items }; strip(shared); return <DataTable {...shared} /> }',
  'a later spread override': 'export const A = ({ rest }) => <DataTable rows={items} {...rest} />',
  'a later literal override': 'export const A = () => <DataTable rows={items} {...{ rows: undefined }} />',
  'a later rows attribute that is undefined': 'export const A = () => <DataTable {...{ rows: items }} rows={undefined} />',
  'a later spread after a literal with rows': 'export function A({ rest }) { const shared = { rows: items }; return <DataTable {...shared} {...rest} /> }',
  'an unresolvable call spread': 'export const A = () => <DataTable {...useTableProps()} />',
  'a member expression spread': 'export const A = ({ props }) => <DataTable {...props.table} />',
  'a spread inside the literal': 'export function A({ rest }) { const shared = { rows: items, ...rest }; return <DataTable {...shared} /> }',
  'a computed key in the literal': 'export function A({ key }) { const shared = { [key]: items }; return <DataTable {...shared} /> }',
  'the kit DataTable used as a value': 'const Wrapped = DataTable\nexport const A = () => <Wrapped rows={items} />',
  'a parenthesised assignment of rows': 'export function A() { const shared = { rows: items }; (shared.rows) = undefined; return <DataTable {...shared} /> }',
  'a non-null assignment of rows': 'export function A() { const shared = { rows: items }; shared.rows! = undefined; return <DataTable {...shared} /> }',
  'an object destructuring assignment to rows': 'export function A() { const shared = { rows: items }; ({ rows: shared.rows } = { rows: undefined }); return <DataTable {...shared} /> }',
  'a parenthesised destructuring target': 'export function A() { const shared = { rows: items }; ({ rows: (shared.rows) } = {}); return <DataTable {...shared} /> }',
  'an array destructuring assignment to rows': 'export function A() { const shared = { rows: items }; [shared.rows] = [undefined]; return <DataTable {...shared} /> }',
  'a destructuring assignment with a rest target': 'export function A() { const shared = { rows: items }; [...shared.rows] = []; return <DataTable {...shared} /> }',
  'a for-of head writing rows': 'export function A() { const shared = { rows: items }; for (shared.rows of [undefined]) {} return <DataTable {...shared} /> }',
  'a logical assignment of rows': 'export function A() { const shared = { rows: items }; shared.rows ??= undefined; return <DataTable {...shared} /> }',
  'a destructured binding': 'export function A({ source }) { const { shared } = source; return <DataTable {...shared} /> }',
};
for (const [name, body] of Object.entries(negatives)) {
  test(`parity:validate fails ${RULE} for ${name}`, async (t) => {
    const result = await validate(t, { 'fixture.tsx': body });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /fixture\.tsx:\d+: parity\/no-implicit-sample-data:/);
  });
}

test('parity:validate reports 0 hits on the real src', async () => {
  const result = await runCli(['tests/parity/validate.mjs']);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, new RegExp(RULE));
});

// --- assertNoSampleData and the settled-state guard, against a fake page (no browser needed) ---

// The fake classes are module-level: guardActions patches prototypes once per worker, as it does for Playwright's.
class FakeLocator {
  click() { return Promise.resolve('clicked'); }
  fill() { return Promise.resolve('filled'); }
  waitFor() { return Promise.resolve('waited'); }
}
class FakeKeyboard { press() { return Promise.resolve(); } }
class FakeMouse { click() { return Promise.resolve(); } }
class FakePage {
  constructor(text, failures) {
    this.closed = false;
    this.calls = { evaluate: 0 };
    this.keyboard = new FakeKeyboard();
    this.mouse = new FakeMouse();
    this.text = text;
    this.failures = failures;
  }
  locator() { return new FakeLocator(); }
  isClosed() { return this.closed; }
  async waitForLoadState() {}
  waitForSelector() { return Promise.resolve('found'); }
  waitForURL() { return Promise.resolve(); }
  waitForFunction() { return Promise.resolve('evaluated'); }
  async evaluate(fn, argument) {
    this.calls.evaluate += 1;
    if (this.calls.evaluate <= this.failures) throw new Error('Execution context was destroyed, most likely because of a navigation');
    globalThis.document = { body: { innerText: typeof this.text === 'function' ? this.text() : this.text } };
    try { return fn(argument); } finally { delete globalThis.document; }
  }
}
function fakePage(text, { failures = 0 } = {}) {
  const page = new FakePage(text, failures);
  return { page, calls: page.calls };
}

test('assertNoSampleData fails on a kit sample row and names it', async () => {
  const { page } = fakePage(`Funciones\n${sampleStrings[0].replace(' ', '\t')}\tRunning\t1,200`);
  await assert.rejects(assertNoSampleData({ page }), /no-sample-data: the page shows kit sample rows: orders-api eu-west-1/);
});

test('assertNoSampleData passes real data that merely shares a name with a sample row', async () => {
  const { page } = fakePage('billing-sync\tnodejs:18\nnotifications eu-central-2');
  await assertNoSampleData({ page });
});

test('assertNoSampleData reads again after a navigation destroyed the execution context', async () => {
  const { page, calls } = fakePage('Inicio', { failures: 2 });
  await assertNoSampleData({ page });
  assert.equal(calls.evaluate, 3);
  const exhausted = fakePage('Inicio', { failures: 9 });
  await assert.rejects(assertNoSampleData({ page: exhausted.page }), /Execution context was destroyed/);
});

test('the guard fails a journey whose sample text appears only after open(), at an action, a readiness assertion or teardown', async (t) => {
  let text = 'Inicio';
  const { page } = fakePage(() => text);
  const parity = { page };
  guardActions(page);
  bindSampleDataGuard(parity, assertNoSampleData);
  t.after(unbindSampleDataGuard);
  // Settled and clean: actions and async assertions pass.
  assert.equal(await page.locator('x').click(), 'clicked');
  await expect(Promise.resolve(1)).resolves.toBe(1);
  // The sample rows appear after open(): the next action, the next readiness assertion and the teardown check all fail.
  text = `Funciones ${sampleStrings[1]} Running`;
  await assert.rejects(page.locator('x').click(), /no-sample-data/);
  await assert.rejects(page.locator('x').fill('v'), /no-sample-data/);
  await assert.rejects(page.keyboard.press('Escape'), /no-sample-data/);
  await assert.rejects(page.mouse.click(1, 1), /no-sample-data/);
  await assert.rejects(expect(Promise.resolve(1)).resolves.toBe(1), /no-sample-data/);
  await assert.rejects(assertNoSampleData(parity), /billing-sync eu-central-1/);
});

test('the guard fails a journey whose sample text appears only after open() at a Locator.waitFor or a Page readiness wait', async (t) => {
  let text = 'Inicio';
  const { page } = fakePage(() => text);
  guardActions(page);
  bindSampleDataGuard({ page }, assertNoSampleData);
  t.after(unbindSampleDataGuard);
  assert.equal(await page.locator('x').waitFor(), 'waited');
  assert.equal(await page.waitForSelector('x'), 'found');
  text = `Funciones ${sampleStrings[2]} Running`;
  await assert.rejects(page.locator('x').waitFor(), /no-sample-data/);
  await assert.rejects(page.waitForSelector('x'), /no-sample-data/);
  await assert.rejects(page.waitForURL('**/x'), /no-sample-data/);
  await assert.rejects(page.waitForFunction(() => true), /no-sample-data/);
});

// A journey helper that imports Playwright's own expect would let sample data appear at its readiness assertion and
// disappear again before the next guarded step. Every journey helper imports the guarded expect instead.
test('no parity journey helper imports the unguarded Playwright expect', () => {
  const unguarded = [];
  const scan = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') scan(path); continue; }
      if (!/\.(?:mjs|ts|tsx)$/.test(entry.name) || /\.d\.mts$|\.config\.mjs$/.test(entry.name) || entry.name === 'sample-data-guard.mjs') continue;
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@playwright\/test['"]/g)) {
        if (/\bexpect\b/.test(match[1])) unguarded.push(path.slice(appRoot.length + 1));
      }
    }
  };
  scan(join(appRoot, 'tests'));
  // The shell and CSP specs do not run through the parity harness; everything else shares its journeys' helpers.
  assert.deepEqual(unguarded.filter((path) => !path.startsWith('tests/shell/') && !path.startsWith('tests/csp/')), []);
});

test('the guard leaves synchronous assertions untouched and ignores closed pages', async (t) => {
  const { page, calls } = fakePage('Inicio');
  guardActions(page);
  bindSampleDataGuard({ page }, assertNoSampleData);
  t.after(unbindSampleDataGuard);
  expect(1).toBe(1);
  assert.throws(() => expect(1).toBe(2));
  assert.equal(calls.evaluate, 0, 'a synchronous matcher does not read the page');
  page.closed = true;
  await page.locator('x').click();
  assert.equal(calls.evaluate, 0);
});

// --- kit-sample-strings.json: extracted from the pinned kit package, regenerated byte for byte ---

const extractor = join(appRoot, 'scripts/extract-kit-sample-strings.mjs');
const extract = (...args) => spawnSync(process.execPath, [extractor, ...args], { cwd: appRoot, encoding: 'utf8' });

test('kit-sample-strings.json records the pinned kit version and the lockfile tarball integrity', () => {
  const committed = JSON.parse(readFileSync(join(appRoot, 'tests/parity/kit-sample-strings.json'), 'utf8'));
  const pin = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')).dependencies['@gntik-ai/blocks'];
  assert.equal(committed.source.version, pin, 'regenerate kit-sample-strings.json after a kit pin change');
  const lock = readFileSync(resolve(appRoot, '../../pnpm-lock.yaml'), 'utf8');
  assert.ok(lock.includes(`'@gntik-ai/blocks@${pin}':\n    resolution: {integrity: ${committed.source.integrity}}`));
  assert.equal(committed.strings.length, 24);
});

test('the committed kit sample strings are byte-identical to the strings extracted from the installed package', (t) => {
  const result = extract('--package', join(appRoot, 'node_modules/@gntik-ai/blocks'), '--check');
  assert.equal(result.status, 0, result.stderr);
  const dir = mkdtempSync(join(tmpdir(), 'kit-sample-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = join(dir, 'regenerated.json');
  assert.equal(extract('--package', join(appRoot, 'node_modules/@gntik-ai/blocks'), '--out', out).status, 0);
  assert.equal(readFileSync(out, 'utf8'), readFileSync(join(appRoot, 'tests/parity/kit-sample-strings.json'), 'utf8'));
});

test('the kit sample strings extraction fails for a tarball whose integrity differs from the lockfile', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'kit-tarball-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tarball = join(dir, 'blocks.tgz');
  assert.equal(spawnSync('tar', ['-czhf', tarball, '-C', join(appRoot, 'node_modules/@gntik-ai'), '--transform', 's#^blocks#package#', 'blocks']).status, 0);
  const result = extract('--tarball', tarball, '--check');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /integrity .* differs from the pnpm-lock\.yaml integrity/);
});

test('the check fails when the committed strings drift from the package', (t) => {
  // --check compares against the committed file: tamper with a scratch copy of the package instead of the repository.
  const dir = mkdtempSync(join(tmpdir(), 'kit-drift-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(spawnSync('cp', ['-rL', join(appRoot, 'node_modules/@gntik-ai/blocks'), join(dir, 'blocks')]).status, 0);
  const index = join(dir, 'blocks/dist/index.js');
  writeFileSync(index, readFileSync(index, 'utf8').replace('const NAMES = [\n\t"orders-api"', 'const NAMES = [\n\t"orders-api-changed"'));
  const drift = extract('--package', join(dir, 'blocks'), '--check');
  assert.equal(drift.status, 1);
  assert.match(drift.stderr, /not byte-identical/);
});
