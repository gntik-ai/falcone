import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { sourceFiles } from './i18n-files.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inputs = process.argv.slice(2);
const attributes = new Set(['aria-label', 'title', 'placeholder']);
let failed = false;
function literal(node) {
  return node && (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node));
}
try {
  for (const path of sourceFiles(inputs.length ? inputs : [resolve(root, 'src')])) {
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    function report(node) {
      const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
      console.error(`${path}:${line + 1}:${character + 1}: translate user-facing copy with t()`);
      failed = true;
    }
    function visit(node) {
      if (ts.isJsxText(node) && node.text.trim()) report(node);
      if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) && literal(node.expression) && node.expression.text.trim()) report(node);
      if (ts.isJsxAttribute(node) && attributes.has(node.name.getText(source))) {
        const value = node.initializer;
        if (literal(value) || (value && ts.isJsxExpression(value) && literal(value.expression))) report(node);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  if (!failed) console.log('i18n literal lint passed.');
} catch (cause) {
  console.error(`Unable to read an i18n-lint input: ${cause.message}`);
  failed = true;
}
if (failed) process.exitCode = 1;
