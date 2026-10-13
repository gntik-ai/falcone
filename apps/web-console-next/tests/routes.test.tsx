import { createMemoryRouter, type RouteObject } from 'react-router-dom'
import { expect, test } from 'vitest'
import { appRoutes } from '../src/router'
import legacyPaths from './fixtures/legacy-route-paths.json'

function fullPaths(routes: RouteObject[], parent = ''): string[] {
  return routes.flatMap((route) => {
    const joined = route.path?.startsWith('/') ? route.path : `${parent}/${route.path ?? ''}`
    const path = `/${joined.split('/').filter(Boolean).join('/')}`
    return [
      ...(route.path !== undefined ? [path] : []),
      ...(route.index ? [path === '/' ? '/' : `${path}/`] : []),
      ...fullPaths(route.children ?? [], path)
    ]
  })
}

// Fixture extracted from the exported legacy appRoutes at edfb9881, including the
// default consoleAuthConfig paths. Pathless layouts contribute no path of their own.
test('the router preserves every normalized legacy full path, index and wildcard', () => {
  const actual = [...new Set(fullPaths(appRoutes))].sort()
  expect(actual).toEqual(legacyPaths)
  expect(actual).toContain('/console/')
  expect(actual).toContain('/console/*')
  // Also let React Router validate that the route nesting is usable.
  const router = createMemoryRouter(appRoutes)
  router.dispose()
})
