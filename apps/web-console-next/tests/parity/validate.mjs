import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { checks } from './check-names.mjs';

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), 'pages'));
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
try { if (process.argv[2] !== '--source' && !visitDirectory(root)) fail(`${root}: no manifests`); }
catch (error) { fail(error.message); }
process.exitCode = failed ? 1 : 0;

// Fail closed when JSX spreads can hide the kit's built-in demonstration rows.
function validateSource(file) {
  const program = ts.createProgram([file], { noResolve: true, noLib: true, jsx: ts.JsxEmit.Preserve });
  const ast = program.getSourceFile(file), checker = program.getTypeChecker();
  if (!ast) { fail(`${file}: cannot read source`); return; }
  const kitTables = new Set(), kitNamespaces = new Set();
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !/^@gntik-ai\/(ui|blocks|templates)$/.test(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const specifier of bindings.elements) if ((specifier.propertyName ?? specifier.name).text === 'DataTable') kitTables.add(specifier.name.text);
    } else if (bindings && ts.isNamespaceImport(bindings)) kitNamespaces.add(bindings.name.text);
  }
  const unwrap = (value) => {
    while (value && (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isSatisfiesExpression(value))) value = value.expression;
    return value;
  };
  const scope = (node) => {
    while (node && !ts.isBlock(node) && !ts.isSourceFile(node) && !ts.isFunctionLike(node)) node = node.parent;
    return node;
  };
  function supplied(expression) {
    const value = unwrap(expression);
    if (!value || value.kind === ts.SyntaxKind.NullKeyword || value.kind === ts.SyntaxKind.VoidExpression || value.getText(ast) === 'undefined') return false;
    if (ts.isIdentifier(value)) {
      const declarations = checker.getSymbolAtLocation(value)?.declarations ?? [];
      if (declarations.some((d) => (ts.isParameter(d) || ts.isBindingElement(d)) && d.initializer)) return false;
    }
    return true;
  }
  function spreadRows(expression, use, seen = new Set()) {
    const value = unwrap(expression);
    if (!value) return false;
    if (ts.isIdentifier(value)) {
      const symbol = checker.getSymbolAtLocation(value);
      if (!symbol || seen.has(symbol) || symbol.declarations?.length !== 1) return false;
      const declaration = symbol.declarations[0];
      if (!ts.isVariableDeclaration(declaration) || !(declaration.parent.flags & ts.NodeFlags.Const) || scope(declaration) !== scope(use)) return false;
      // A const binding can still be mutated or escape through a call/alias.
      let safe = true;
      function references(node) {
        if (ts.isIdentifier(node) && node !== declaration.name && checker.getSymbolAtLocation(node) === symbol) {
          if (!ts.isJsxSpreadAttribute(node.parent)) safe = false;
        }
        ts.forEachChild(node, references);
      }
      references(ast);
      if (!safe) return false;
      return spreadRows(declaration.initializer, use, new Set([...seen, symbol]));
    }
    if (!ts.isObjectLiteralExpression(value)) return false;
    let rows = false;
    for (const prop of value.properties) {
      if (ts.isSpreadAssignment(prop)) rows = spreadRows(prop.expression, use, seen);
      else if (prop.name?.getText(ast).replace(/['"]/g, '') === 'rows') {
        rows = (ts.isPropertyAssignment(prop) && supplied(prop.initializer)) || (ts.isShorthandPropertyAssignment(prop) && supplied(prop.name));
      } else if (ts.isComputedPropertyName(prop.name)) rows = false;
    }
    return rows;
  }
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName;
      const isTable = kitTables.has(tag.getText(ast)) || (ts.isPropertyAccessExpression(tag) && kitNamespaces.has(tag.expression.getText(ast)) && tag.name.text === 'DataTable');
      if (isTable) {
        let rows = false;
        for (const attribute of node.attributes.properties) {
          if (ts.isJsxSpreadAttribute(attribute)) rows = spreadRows(attribute.expression, node);
          else if (attribute.name.text === 'rows') rows = ts.isJsxExpression(attribute.initializer) && supplied(attribute.initializer.expression);
        }
        if (!rows) fail(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: parity/no-implicit-sample-data: DataTable requires provable rows after all overrides`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
function visitSource(path) {
  if (/\.[cm]?[jt]sx?$/.test(path)) { validateSource(path); return; }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory()) visitSource(join(path, entry.name));
    else if (/\.[jt]sx$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) validateSource(join(path, entry.name));
  }
}
try {
  if (process.argv[2] === '--source') visitSource(resolve(process.argv[3]));
  else if (!process.argv[2]) visitSource(resolve(dirname(fileURLToPath(import.meta.url)), '../../src'));
} catch (error) { fail(error.message); }
process.exitCode = failed ? 1 : 0;
