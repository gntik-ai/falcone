import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { checks } from './check-names.mjs';
import { RULE, scanSource } from './no-implicit-sample-data.mjs';

// validate.mjs [pages dir] [--src <dir>]: the manifests under the pages dir, then the sample-data rule over the sources.
const args = process.argv.slice(2);
const flag = args.indexOf('--src');
const srcArg = flag === -1 ? null : args.splice(flag, 2)[1];
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(args[0] ?? join(here, 'pages'));
const srcRoot = resolve(srcArg ?? join(here, '../../src'));
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
function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path);
    return /\.(?:[jt]sx?|mjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : [];
  });
}
try {
  if (!visitDirectory(root)) fail(`${root}: no manifests`);
  for (const file of sources(srcRoot)) for (const hit of scanSource(file, readFileSync(file, 'utf8'))) fail(`${file}:${hit.line}: ${RULE}: ${hit.message}`);
} catch (error) { fail(error.message); }
process.exitCode = failed ? 1 : 0;
