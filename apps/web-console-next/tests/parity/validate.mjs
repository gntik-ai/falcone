import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { checks } from './check-names.mjs';
import { scanSource } from './sample-data-rule.mjs';

// validate.mjs [pagesDir] [--src <dir>]: checks the page manifests and, with the default pages directory or an explicit
// --src, scans the application source for kit DataTables that would render sample data (parity/no-implicit-sample-data).
const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const srcFlag = args.indexOf('--src');
const srcArgument = srcFlag === -1 ? undefined : args[srcFlag + 1];
const positional = args.filter((arg, index) => !arg.startsWith('--') && (srcFlag === -1 || index !== srcFlag + 1));
const root = resolve(positional[0] ?? join(here, 'pages'));
const srcRoot = srcArgument ? resolve(srcArgument) : positional[0] ? undefined : resolve(here, '../../src');
let failed = false;
function fail(message) { console.error(message); failed = true; }
function visitDirectory(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  let manifests = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) { manifests += visitDirectory(join(dir, entry.name)); continue; }
    if (!entry.name.endsWith('.manifest.ts')) continue;
    manifests++;
    const file = join(dir, entry.name.replace('.manifest.ts', '.spec.mjs'));
    let source;
    try { source = readFileSync(file, 'utf8'); } catch { fail(`${file}: missing template spec`); continue; }
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const found = new Map();
    function visit(node) {
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(ast);
        if (/\btest\.(?:\w+\.)*(?:skip|fixme|only)\b/.test(callee)) fail(`${file}: forbidden ${callee}`);
        if (callee === 'test' && node.arguments.length >= 2 && ts.isStringLiteral(node.arguments[0])) {
          const name = node.arguments[0].text;
          const callback = node.arguments.at(-1);
          if ((ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && callback.body?.statements?.length) found.set(name, (found.get(name) ?? 0) + 1);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    for (const name of checks) if (found.get(name) !== 1) fail(`${file}: requires exactly one executable ${name} check`);
  }
  return manifests;
}
function scanDirectory(dir) {
  let files = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') files += scanDirectory(path); continue; }
    if (!/\.(?:tsx?|jsx?|mjs|cjs)$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue;
    files++;
    for (const hit of scanSource(path, readFileSync(path, 'utf8'))) fail(hit);
  }
  return files;
}
try { if (!visitDirectory(root)) fail(`${root}: no manifests`); }
catch (error) { fail(error.message); }
try { if (srcRoot && !scanDirectory(srcRoot)) fail(`${srcRoot}: no source files`); }
catch (error) { fail(error.message); }
process.exitCode = failed ? 1 : 0;
