// parity/no-implicit-sample-data: a kit <DataTable> without `rows` renders the kit's built-in sample deployments. The rule
// fails closed: a DataTable passes only when its effective `rows` is provably supplied.
//
//  - a `rows` attribute that is not nullish and comes after every spread attribute, or
//  - a spread whose binding resolves statically, in an enclosing scope, to a `const` object literal that has a `rows`
//    property, where the literal has no spread, the binding is never reassigned or mutated (it is only spread into
//    DataTable elements or read through property access), and no later spread or attribute can override it.
//
// Anything else fails: shadowed names, parameters (with or without defaults), `let`/`var`, reassignment or mutation, a
// later spread, an unresolvable spread, `rows` set to undefined/null, a method call on the binding (it may redefine `rows`),
// and any use of the kit DataTable outside JSX, including through a namespace import that is destructured, indexed, aliased
// or passed on.
import ts from 'typescript';

export const RULE = 'parity/no-implicit-sample-data';

const strip = (node) => {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node))) node = node.expression;
  return node;
};
const isNullish = (node) => {
  node = strip(node);
  return !node || node.kind === ts.SyntaxKind.NullKeyword || ts.isVoidExpression(node) || (ts.isIdentifier(node) && node.text === 'undefined');
};
const propertyName = (name) => (ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null);

function kitBindings(source) {
  const direct = new Set();
  const namespaces = new Set();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.startsWith('@gntik-ai/')) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    else for (const element of bindings.elements) if ((element.propertyName ?? element.name).text === 'DataTable') direct.add(element.name.text);
  }
  return { direct, namespaces };
}

// 'supplies': the literal sets rows; 'neutral': it cannot affect rows; 'unknown': it might.
function classifyLiteral(literal) {
  let supplies = false;
  for (const property of literal.properties) {
    if (ts.isSpreadAssignment(property)) return 'unknown';
    if (ts.isShorthandPropertyAssignment(property)) { if (property.name.text === 'rows') supplies = true; continue; }
    if (ts.isPropertyAssignment(property)) {
      if (ts.isComputedPropertyName(property.name)) return 'unknown';
      // rows set to undefined/null overrides an earlier rows with a value that makes the table fall back to samples.
      if (propertyName(property.name) === 'rows') { if (isNullish(property.initializer)) return 'unknown'; supplies = true; }
      continue;
    }
    if (property.name && (ts.isComputedPropertyName(property.name) || propertyName(property.name) === 'rows')) return 'unknown';
  }
  return supplies ? 'supplies' : 'neutral';
}

const bindsName = (name, wanted) => ts.isIdentifier(name) ? name.text === wanted : name.elements.some((element) => !ts.isOmittedExpression(element) && bindsName(element.name, wanted));

function findDeclaration(name, from) {
  for (let scope = from.parent; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope) && scope.parameters?.some((parameter) => bindsName(parameter.name, name))) return { scope, unresolvable: true };
    if (ts.isCatchClause(scope) && scope.variableDeclaration && bindsName(scope.variableDeclaration.name, name)) return { scope, unresolvable: true };
    const statements = ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isModuleBlock(scope) ? scope.statements : ts.isCaseClause(scope) || ts.isDefaultClause(scope) ? scope.statements : null;
    if (!statements) continue;
    for (const statement of statements) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!bindsName(declaration.name, name)) continue;
          const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
          return { scope, declaration, unresolvable: !isConst || !ts.isIdentifier(declaration.name) };
        }
      } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === name) return { scope, unresolvable: true };
      else if (ts.isImportDeclaration(statement) && statement.importClause) {
        const clause = statement.importClause;
        const names = [clause.name?.text, ...(clause.namedBindings ? (ts.isNamespaceImport(clause.namedBindings) ? [clause.namedBindings.name.text] : clause.namedBindings.elements.map((element) => element.name.text)) : [])];
        if (names.includes(name)) return { scope, unresolvable: true };
      }
    }
  }
  return null;
}

// Every use of the binding other than its declaration must be a spread into a JSX element or a read through a property.
function isNeverMutated(scope, declaration, name) {
  let clean = true;
  const visit = (node) => {
    if (!clean) return;
    if (ts.isIdentifier(node) && node.text === name && node !== declaration.name) {
      const parent = node.parent;
      const spreadIntoJsx = ts.isJsxSpreadAttribute(parent) && strip(parent.expression) === node;
      let propertyRead = false;
      if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node) {
        // Climb out of wrappers, `(shared.rows) = x` and `shared.rows! = x` write like `shared.rows = x`, and treat a property
        // used as a destructuring target (`({ a: shared.rows } = x)`, `[shared.rows] = x`) as a write as well: any
        // enclosing literal, property, spread or loop head is conservatively a write.
        let target = parent;
        while (target.parent && strip(target.parent) === strip(target) && target.parent !== target) target = target.parent;
        const outer = target.parent;
        const written = (ts.isBinaryExpression(outer) && outer.left === target && outer.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && outer.operatorToken.kind <= ts.SyntaxKind.LastAssignment)
          || ((ts.isPrefixUnaryExpression(outer) || ts.isPostfixUnaryExpression(outer)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(outer.operator))
          || ts.isDeleteExpression(outer)
          || ts.isShorthandPropertyAssignment(outer)
          || ts.isPropertyAssignment(outer)
          || ts.isSpreadElement(outer)
          || ts.isSpreadAssignment(outer)
          || ts.isArrayLiteralExpression(outer) || ts.isObjectLiteralExpression(outer) || ts.isForInStatement(outer) || ts.isForOfStatement(outer);
        // A call on the binding (`shared.__defineGetter__('rows', ...)`) can redefine rows, so it is not a plain read.
        const called = (ts.isCallExpression(outer) && outer.expression === target) || (ts.isTaggedTemplateExpression(outer) && outer.tag === target) || (ts.isNewExpression(outer) && outer.expression === target);
        propertyRead = !written && !called;
      }
      if (!spreadIntoJsx && !propertyRead) clean = false;
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return clean;
}

function classifySpread(expression, element) {
  const node = strip(expression);
  if (ts.isObjectLiteralExpression(node)) return classifyLiteral(node);
  if (!ts.isIdentifier(node)) return 'unknown';
  const found = findDeclaration(node.text, element);
  if (!found || found.unresolvable) return 'unknown';
  const initializer = strip(found.declaration.initializer);
  if (!initializer || !ts.isObjectLiteralExpression(initializer)) return 'unknown';
  if (!isNeverMutated(found.scope, found.declaration, node.text)) return 'unknown';
  return classifyLiteral(initializer);
}

function rowsProvided(element) {
  let provided = false;
  for (const attribute of element.attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) {
      const effect = classifySpread(attribute.expression, element);
      if (effect === 'supplies') provided = true;
      else if (effect === 'unknown') provided = false;
    } else if (ts.isJsxAttribute(attribute) && ts.isIdentifier(attribute.name) && attribute.name.text === 'rows') {
      const initializer = attribute.initializer;
      provided = !!initializer && ts.isJsxExpression(initializer) && !isNullish(initializer.expression);
    }
  }
  return provided;
}

// Returns [{ line, message }] for one source file.
export function scanSource(fileName, text) {
  if (!text.includes('@gntik-ai/')) return [];
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const { direct, namespaces } = kitBindings(source);
  if (!direct.size && !namespaces.size) return [];
  const hits = [];
  const report = (node, message) => hits.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, message });
  const isKitTag = (tag) => (ts.isIdentifier(tag) && direct.has(tag.text)) || (ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.expression) && namespaces.has(tag.expression.text) && tag.name.text === 'DataTable');
  // Only `Kit.Other` and `Kit['Other']` leave the namespace alone. Destructuring, aliasing, passing it on and computed keys
  // can all produce the kit DataTable under another name, so they are refused.
  const namespaceUseIsSafe = (node) => {
    const parent = node.parent;
    if ((ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) && parent.name === node) return true;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === node) return parent.name.text !== 'DataTable' || (ts.isJsxOpeningLikeElement(parent.parent) && parent.parent.tagName === parent);
    if (ts.isElementAccessExpression(parent) && parent.expression === node) {
      const key = parent.argumentExpression;
      return !!key && (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) && key.text !== 'DataTable';
    }
    return false;
  };
  const visit = (node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && isKitTag(node.tagName)) {
      if (!rowsProvided(node)) report(node, 'DataTable renders the kit sample rows: its `rows` prop is not provably supplied');
    } else if (ts.isJsxClosingElement(node) || ts.isImportDeclaration(node) || ts.isTypeNode(node)) {
      return;
    } else if (ts.isIdentifier(node) && direct.has(node.text) && !(ts.isJsxOpeningLikeElement(node.parent) && node.parent.tagName === node)
      && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)) {
      report(node, 'the kit DataTable is used outside JSX, so its `rows` prop cannot be proven');
    } else if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && namespaces.has(node.expression.text) && node.name.text === 'DataTable' && !(ts.isJsxOpeningLikeElement(node.parent) && node.parent.tagName === node)) {
      report(node, 'the kit DataTable is used outside JSX, so its `rows` prop cannot be proven');
    } else if (ts.isIdentifier(node) && namespaces.has(node.text) && !namespaceUseIsSafe(node)) {
      report(node, 'the kit namespace is used in a way that can reach DataTable outside JSX, so its `rows` prop cannot be proven');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}
