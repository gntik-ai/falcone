// parity/no-implicit-sample-data: a kit DataTable (from @gntik-ai/blocks) renders its built-in sample deployments when it
// gets no rows. This rule accepts a DataTable element only when its rows are visibly supplied, by exactly one of:
//   1. a `rows` JSX attribute written after every spread on that element, whatever its value expression; or
//   2. spreads only of identifiers that each resolve, in the same module, to a top-level `const` initialised with an
//      object literal that has a literal `rows` key (and no later spread that could override it), where every other
//      reference to that identifier in the module is itself a JSX spread: no member access, call, assignment, export,
//      `delete`, or use as an argument.
// Everything else fails with file:line: any other spread, a re-export or dynamic import of the kit, any computed access,
// any use of the DataTable binding other than as a JSX element, and any file the parser cannot parse. The runtime check
// (assertNoSampleData) remains the guarantee that sample data never renders; this is defence in depth against honest
// mistakes in reviewed source, not against deliberate obfuscation.
import ts from 'typescript';

export const RULE = 'parity/no-implicit-sample-data';
const KIT = '@gntik-ai/blocks';
const TABLE = 'DataTable';

const kindOf = (file) => (file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.jsx') ? ts.ScriptKind.JSX : /\.(?:mjs|cjs|js)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
const isTagName = (node) => {
  const parent = node.parent;
  return (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent) || ts.isJsxClosingElement(parent)) && parent.tagName === node;
};
const unwrap = (node) => {
  let current = node;
  while (current && (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression?.(current) || ts.isTypeAssertionExpression(current))) current = current.expression;
  return current;
};
const keyName = (name) => (name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : undefined);

// An identifier that names a value (not a property key, member name or attribute name).
function isReference(node) {
  const parent = node.parent;
  if (!parent) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isQualifiedName(parent) && parent.right === node) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent)
    || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) || ts.isEnumMember(parent)) && parent.name === node) return false;
  if (ts.isJsxAttribute(parent) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return parent.isTypeOnly ? false : ts.isExportSpecifier(parent);
  return true;
}

function referencesOf(sourceFile, name, declarationName) {
  const found = [];
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === name && node !== declarationName && isReference(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

// Top-level `const name = { ..., rows: ..., }` whose object literal cannot be overridden after `rows`.
function topLevelRowsObject(sourceFile, name) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
      if (!(statement.declarationList.flags & ts.NodeFlags.Const)) return { problem: `${name} is not a const` };
      if (statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) return { problem: `${name} is exported` };
      const literal = declaration.initializer ? unwrap(declaration.initializer) : undefined;
      if (!literal || !ts.isObjectLiteralExpression(literal)) return { problem: `${name} is not initialised with an object literal` };
      let rowsIndex = -1;
      literal.properties.forEach((property, index) => {
        if ((ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) && keyName(property.name) === 'rows') rowsIndex = index;
      });
      if (rowsIndex === -1) return { problem: `${name} has no literal rows key` };
      if (literal.properties.slice(rowsIndex + 1).some((property) => ts.isSpreadAssignment(property))) return { problem: `${name} spreads another object after its rows key` };
      return { declaration };
    }
  }
  return { problem: `${name} is not a top-level const of this module` };
}

export function scanSource(file, text) {
  const hits = [];
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kindOf(file));
  const position = (node) => `${file}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}`;
  const fail = (node, message) => hits.push(`${position(node)}: ${RULE}: ${message}`);
  if (sourceFile.parseDiagnostics?.length) {
    const [diagnostic] = sourceFile.parseDiagnostics;
    const line = sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1;
    return [`${file}:${line}: ${RULE}: the file cannot be parsed (${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')})`];
  }
  if (!text.includes(KIT)) return hits;

  const tableBindings = new Map();
  const namespaceBindings = new Map();
  const visitImports = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === KIT && !node.importClause?.isTypeOnly) {
      const { namedBindings, name } = node.importClause ?? {};
      if (name) namespaceBindings.set(name.text, name);
      if (namedBindings && ts.isNamespaceImport(namedBindings)) namespaceBindings.set(namedBindings.name.text, namedBindings.name);
      if (namedBindings && ts.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements) {
          if (!element.isTypeOnly && (element.propertyName ?? element.name).text === TABLE) tableBindings.set(element.name.text, element.name);
        }
      }
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === KIT && !node.isTypeOnly) {
      const named = node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements : undefined;
      if (!named || named.some((element) => !element.isTypeOnly && (element.propertyName ?? element.name).text === TABLE)) fail(node, `re-exports the kit's ${TABLE}`);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      && node.arguments.length && ts.isStringLiteralLike(node.arguments[0]) && node.arguments[0].text === KIT) fail(node, `loads ${KIT} dynamically, so ${TABLE} cannot be traced`);
    ts.forEachChild(node, visitImports);
  };
  visitImports(sourceFile);

  const elements = [];
  for (const [name, declaration] of tableBindings) {
    for (const reference of referencesOf(sourceFile, name, declaration)) {
      if (isTagName(reference)) {
        if (!ts.isJsxClosingElement(reference.parent)) elements.push(reference.parent);
      } else fail(reference, `${TABLE} is used other than as a JSX element`);
    }
  }
  for (const [name, declaration] of namespaceBindings) {
    for (const reference of referencesOf(sourceFile, name, declaration)) {
      const parent = reference.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.expression === reference) {
        if (parent.name.text !== TABLE) continue;
        const tag = parent.parent;
        if ((ts.isJsxOpeningElement(tag) || ts.isJsxSelfClosingElement(tag) || ts.isJsxClosingElement(tag)) && tag.tagName === parent) {
          if (!ts.isJsxClosingElement(tag)) elements.push(tag);
        } else fail(parent, `${TABLE} is used other than as a JSX element`);
      } else if (ts.isElementAccessExpression(parent) && parent.expression === reference) fail(parent, `computed access on the ${KIT} namespace`);
      else if (!isTagName(reference)) fail(reference, `the ${KIT} namespace is used other than for member access`);
    }
  }

  for (const element of elements) {
    const attributes = element.attributes.properties;
    const lastSpread = attributes.reduce((last, attribute, index) => (ts.isJsxSpreadAttribute(attribute) ? index : last), -1);
    const lastRows = attributes.reduce((last, attribute, index) => (ts.isJsxAttribute(attribute) && ts.isIdentifier(attribute.name) && attribute.name.text === 'rows' ? index : last), -1);
    if (lastRows > lastSpread) continue;
    const spreads = attributes.filter(ts.isJsxSpreadAttribute);
    if (spreads.length === 0) {
      fail(element, `${TABLE} has no rows prop, so it would render the kit's sample deployments`);
      continue;
    }
    for (const spread of spreads) {
      const expression = spread.expression;
      if (!ts.isIdentifier(expression)) {
        fail(spread, `${TABLE} spreads an expression that is not a plain identifier, so rows cannot be proven`);
        continue;
      }
      const resolved = topLevelRowsObject(sourceFile, expression.text);
      if (resolved.problem) {
        fail(spread, `${TABLE} spreads ${expression.text}, which does not provably supply rows: ${resolved.problem}`);
        continue;
      }
      for (const reference of referencesOf(sourceFile, expression.text, resolved.declaration.name)) {
        if (!(ts.isJsxSpreadAttribute(reference.parent) && reference.parent.expression === reference)) {
          fail(reference, `${expression.text} is used other than as a JSX spread, so its rows may change`);
        }
      }
    }
  }
  return [...new Set(hits)];
}
