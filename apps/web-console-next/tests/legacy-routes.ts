import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

import { consoleAuthConfig } from '../../../packages/console-api/src/config'

type RoutePaths = { path?: string; index?: boolean; children?: RoutePaths[] }

// Read the public route configuration without importing the legacy React 18 app,
// executing its browser router, or replacing any of its components with mocks.
export function legacyRoutes(): RoutePaths[] {
  const file = resolve('../web-console/src/router.tsx')
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let routes: ts.Expression | undefined
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(source) === 'appRoutes') routes = declaration.initializer
    }
  }

  function readArray(expression: ts.Expression | undefined): RoutePaths[] {
    if (!expression || !ts.isArrayLiteralExpression(expression)) throw new Error('Expected a route array')
    return expression.elements.map((element) => {
      if (!ts.isObjectLiteralExpression(element)) throw new Error('Expected a route object')
      const route: RoutePaths = {}
      for (const property of element.properties) {
        if (!ts.isPropertyAssignment(property)) throw new Error('Unsupported route property')
        const name = property.name.getText(source)
        const value = property.initializer
        if (name === 'children') route.children = readArray(value)
        if (name === 'index') {
          if (value.kind !== ts.SyntaxKind.TrueKeyword) throw new Error('Unsupported index route')
          route.index = true
        }
        if (name === 'path') {
          if (ts.isStringLiteral(value)) route.path = value.text
          else if (ts.isPropertyAccessExpression(value) && value.expression.getText(source) === 'consoleAuthConfig') {
            const path = consoleAuthConfig[value.name.text as keyof typeof consoleAuthConfig]
            if (typeof path !== 'string') throw new Error('Expected an auth path')
            route.path = path
          } else throw new Error(`Unsupported route path: ${value.getText(source)}`)
        }
      }
      return route
    })
  }
  return readArray(routes)
}

export function fullPaths(routes: RoutePaths[], parent = ''): Set<string> {
  const paths = new Set<string>()
  for (const route of routes) {
    const path = route.path === undefined ? parent : route.path.startsWith('/')
      ? route.path
      : `${parent}/${route.path}`.replace(/\/{2,}/g, '/')
    if (route.index) paths.add(`${path.replace(/\/$/, '')}/`)
    else if (route.path !== undefined) paths.add(path || '/')
    for (const child of fullPaths(route.children ?? [], path)) paths.add(child)
  }
  return paths
}
