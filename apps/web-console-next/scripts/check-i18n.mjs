import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { sourceFiles } from './i18n-files.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [locales = resolve(root, 'src/locales'), ...sources] = process.argv.slice(2);
const referenced = new Set(['common']);
let failed = false;
function error(message) { console.error(message); failed = true; }
function keys(value, prefix = '') {
  if (typeof value === 'string') return [prefix];
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(`Invalid translation at ${prefix}`);
  return Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key));
}
try {
  // Source parsing avoids comments and supports both quote styles and namespace arrays.
  for (const path of sourceFiles(sources.length ? sources : [resolve(root, 'src')])) {
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    function visit(node) {
      if (ts.isCallExpression(node) && ['lazyPage', 'placeholderPage', 'useTranslation'].includes(node.expression.getText(source))) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteralLike(argument)) referenced.add(argument.text);
        if (argument && ts.isArrayLiteralExpression(argument)) {
          for (const item of argument.elements) if (ts.isStringLiteralLike(item)) referenced.add(item.text);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  const namespaces = new Set(referenced);
  for (const locale of ['es', 'en']) {
    for (const file of readdirSync(resolve(locales, locale))) if (file.endsWith('.json')) namespaces.add(file.slice(0, -5));
  }
  for (const namespace of namespaces) {
    const paths = ['es', 'en'].map((locale) => resolve(locales, locale, `${namespace}.json`));
    if (paths.some((path) => !existsSync(path))) { error(`Namespace ${namespace}: missing resource in es or en`); continue; }
    const [es, en] = paths.map((path) => new Set(keys(JSON.parse(readFileSync(path, 'utf8')))));
    for (const key of es) if (!en.has(key)) error(`${namespace}.${key}: missing in en`);
    for (const key of en) if (!es.has(key)) error(`${namespace}.${key}: missing in es`);
  }
  if (!failed) console.log('i18n resources match.');
} catch (cause) { error(`Unable to check i18n resources: ${cause.message}`); }
if (failed) process.exitCode = 1;
