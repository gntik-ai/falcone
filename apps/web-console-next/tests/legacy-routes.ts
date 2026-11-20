import frozenRoutes from './frozen-legacy/routes.json'

type RoutePaths = { path?: string; index?: boolean; children?: RoutePaths[] }

// Frozen public route configuration from base 69296937330b61be2bbf2c7267520196499fc038.
export function legacyRoutes(): RoutePaths[] {
  return structuredClone(frozenRoutes)
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
