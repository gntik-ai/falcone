import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCli } from '../../apps/web-console-next/tests/run-cli.mjs';

// parity:validate runs as a CLI against fixture source trees; each fixture is a file in a temporary --src directory.
const CHECKS = ['data', 'action', 'error-empty', 'accessibility', 'runtime-health', 'responsive', 'visual-review', 'kit-conformance'];

async function withFixture(files, run) {
  const dir = mkdtempSync(join(tmpdir(), 'parity-sample-'));
  try {
    const pages = join(dir, 'pages');
    const src = join(dir, 'src');
    mkdirSync(pages);
    mkdirSync(src);
    writeFileSync(join(pages, 'overview.manifest.ts'), 'export default {}');
    writeFileSync(join(pages, 'overview.spec.mjs'), CHECKS.map((name) => `test('${name}', async () => { await check(); });`).join('\n'));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(src, name), text);
    return await run(async () => runCli(['tests/parity/validate.mjs', pages, '--src', src]), src);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const imports = "import { DataTable } from '@gntik-ai/blocks'\n";
const rejects = (name, source, line, message) => test(`parity:validate rejects ${name}`, () => withFixture({ 'page.tsx': source }, async (validate, src) => {
  const result = await validate();
  assert.equal(result.status, 1, result.stderr);
  assert.ok(result.stderr.includes(`${join(src, 'page.tsx')}:${line}: parity/no-implicit-sample-data`), result.stderr);
  if (message) assert.match(result.stderr, message);
}));
const accepts = (name, source) => test(`parity:validate accepts ${name}`, () => withFixture({ 'page.tsx': source }, async (validate) => {
  const result = await validate();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
}));

accepts('a rows attribute written after every spread', `${imports}
export const Page = ({ extra, data }: any) => <DataTable {...extra} columns={[]} rows={data.items} />
`);
accepts('a rows attribute with no spread, and a closing-tag element with children', `${imports}
export const Page = ({ data }: any) => <DataTable<{ id: string }> rows={data} columns={[]}></DataTable>
`);
accepts('a spread of a top-level const object literal with a literal rows key', `${imports}
const shared = { rows: [], columns: [], caption: 'x' }
export const Page = () => <DataTable {...shared} selectable={false} />
export const Other = () => <DataTable {...shared} />
`);
accepts('the same forms through an import alias and a namespace import', `import { DataTable as Grid } from '@gntik-ai/blocks'
import * as Kit from '@gntik-ai/blocks'
const fixed = { rows: [1] } as const
export const A = () => <Grid {...fixed} />
export const B = ({ rows }: any) => <Kit.DataTable columns={[]} rows={rows} />
export const C = () => <Kit.PageToolbar />
`);
accepts('source that does not use the kit DataTable at all', `import { DataTable } from './local-table'
export const Page = () => <DataTable />
`);

rejects('a DataTable with no rows', `${imports}
export const Page = () => <DataTable columns={[]} caption="x" />
`, 3, /no rows prop/);
rejects('a rows attribute followed by a spread (a later override)', `${imports}
export const Page = ({ extra }: any) => <DataTable rows={[]} {...extra} />
`, 3, /not a plain identifier|does not provably supply rows/);
rejects('a spread of an expression', `${imports}
export const Page = ({ extra }: any) => <DataTable {...extra.table} />
`, 3, /not a plain identifier/);
rejects('a spread of a parameter, even when it is named like a top-level const', `${imports}
const shared = { rows: [] }
export const Page = ({ shared }: any) => <DataTable {...shared} />
`, 4, /used other than as a JSX spread/);
rejects('a spread of a const defined inside a function', `${imports}
export function Page({ rows }: any) {
  const shared = { rows }
  return <DataTable {...shared} />
}
`, 5, /not a top-level const/);
rejects('a spread of an object literal without a rows key', `${imports}
const shared = { columns: [] }
export const Page = () => <DataTable {...shared} />
`, 4, /no literal rows key/);
rejects('a spread of a let binding', `${imports}
let shared = { rows: [] }
export const Page = () => <DataTable {...shared} />
`, 4, /not a const/);
rejects('a spread of a binding that is reassigned', `${imports}
const shared = { rows: [] }
shared = {}
export const Page = () => <DataTable {...shared} />
`, 4, /used other than as a JSX spread/);
rejects('a spread of a binding whose rows is mutated through member access', `${imports}
const shared = { rows: [] }
shared.rows = undefined
export const Page = () => <DataTable {...shared} />
`, 4, /used other than as a JSX spread/);
rejects('a spread of a binding that is deleted from or passed as an argument', `${imports}
const shared = { rows: [] }
delete shared.rows
Object.freeze(shared)
export const Page = () => <DataTable {...shared} />
`, 5, /used other than as a JSX spread/);
rejects('a spread of an exported binding', `${imports}
export const shared = { rows: [] }
export const Page = () => <DataTable {...shared} />
`, 4, /is exported/);
rejects('a spread of an object literal that spreads another object after rows', `${imports}
const base = {}
const shared = { rows: [], ...base }
export const Page = () => <DataTable {...shared} />
`, 5, /spreads another object after its rows key/);
rejects('a later spread that could override rows', `${imports}
const shared = { rows: [] }
export const Page = ({ extra }: any) => <DataTable {...shared} {...extra} />
`, 4, /not a plain identifier|does not provably supply rows|used other than as a JSX spread/);
rejects('a re-export of the DataTable', `export { DataTable } from '@gntik-ai/blocks'
`, 1, /re-exports/);
rejects('a star re-export of the kit', `export * from '@gntik-ai/blocks'
`, 1, /re-exports/);
rejects('a DataTable used as a value', `${imports}
const Table = DataTable
export const Page = () => <Table rows={[]} />
`, 3, /used other than as a JSX element/);
rejects('a DataTable passed to createElement', `${imports}
import { createElement } from 'react'
export const Page = () => createElement(DataTable, {})
`, 4, /used other than as a JSX element/);
rejects('a namespace member used as a value', `import * as Kit from '@gntik-ai/blocks'
const Table = Kit.DataTable
export const Page = () => <Table rows={[]} />
`, 2, /used other than as a JSX element/);
rejects('computed access on the kit namespace', `import * as Kit from '@gntik-ai/blocks'
const Table = Kit['DataTable']
export const Page = () => <Table rows={[]} />
`, 2, /computed access/);
rejects('the kit namespace used other than for member access', `import * as Kit from '@gntik-ai/blocks'
export const Page = () => helper(Kit)
`, 2, /namespace is used other than for member access/);
rejects('a dynamic import of the kit', `export const load = () => import('@gntik-ai/blocks')
`, 1, /dynamically/);

test('parity:validate rejects a file the parser cannot parse and names the file and line', () => withFixture({ 'broken.tsx': `${imports}\nexport const Page = () => <DataTable rows={[]}\n` }, async (validate, src) => {
  const result = await validate();
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`${join(src, 'broken.tsx').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\d+: parity/no-implicit-sample-data: the file cannot be parsed`));
}));

test('parity:validate reports every hit, one line each, and still passes the manifest checks', () => withFixture({
  'a.tsx': `${imports}\nexport const A = () => <DataTable columns={[]} />\n`,
  'b.tsx': `${imports}\nexport const B = () => <DataTable />\n`,
  'ok.tsx': `${imports}\nexport const C = () => <DataTable rows={[]} />\n`
}, async (validate) => {
  const result = await validate();
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim().split('\n').length, 2, result.stderr);
}));

test('parity:validate reports 0 hits on the application source', async () => {
  const result = await runCli(['tests/parity/validate.mjs']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});
