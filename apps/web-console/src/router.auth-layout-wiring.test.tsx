import { isValidElement, type ReactElement } from 'react'
import { describe, expect, it } from 'vitest'

import { AuthLayout } from '@/layouts/AuthLayout'
import { consoleAuthConfig } from '@/lib/console-config'

import { appRoutes } from './router'

interface RouteNode {
  path?: string
  index?: boolean
  element?: ReactElement
  handle?: { title?: string }
  children?: RouteNode[]
}

const ROUTE_TREE = appRoutes as unknown as RouteNode[]

// [#731] Structural guard on the REAL production route table (router.tsx), independent of
// AuthLayout.test.tsx's behavioral coverage (which uses its own proxy route table): every
// unauthenticated screen — including the 404 catch-all — must be a child of the SAME AuthLayout
// parent route, each carrying the exact localized `handle.title` the layout reads to set
// `document.title`.
const EXPECTED_UNAUTH_ROUTES: Array<{ path: string; title: string }> = [
  { path: '/', title: 'Bienvenida · Consola In Falcone' },
  { path: '/login', title: 'Acceso · Consola In Falcone' },
  { path: consoleAuthConfig.passwordRecoveryPath, title: 'Recuperar contraseña · Consola In Falcone' },
  { path: '/signup', title: 'Solicitar acceso · Consola In Falcone' },
  { path: '/signup/pending-activation', title: 'Registro pendiente · Consola In Falcone' },
  { path: '*', title: 'Página no encontrada · Consola In Falcone' }
]

function findAuthLayoutRoute(): RouteNode {
  const found = ROUTE_TREE.find((route) => isValidElement(route.element) && route.element.type === AuthLayout)
  if (!found) {
    throw new Error('No top-level route renders AuthLayout as its element')
  }
  return found
}

describe('router unauthenticated route wiring [#731]', () => {
  it('every unauthenticated route (including the 404 catch-all) is a child of the same AuthLayout layout route', () => {
    const authLayoutRoute = findAuthLayoutRoute()
    const childPaths = (authLayoutRoute.children ?? []).map((child) => child.path)

    for (const { path } of EXPECTED_UNAUTH_ROUTES) {
      expect(childPaths).toContain(path)
    }
  })

  it.each(EXPECTED_UNAUTH_ROUTES)('route "$path" carries handle.title "$title"', ({ path, title }) => {
    const authLayoutRoute = findAuthLayoutRoute()
    const child = (authLayoutRoute.children ?? []).find((route) => route.path === path)

    expect(child).toBeDefined()
    expect(child?.handle?.title).toBe(title)
  })

  it('no unauthenticated route sits outside AuthLayout at the top level (the funnel has exactly one shared layout)', () => {
    const authLayoutRoute = findAuthLayoutRoute()
    const topLevelPaths = ROUTE_TREE.filter((route) => route !== authLayoutRoute).map((route) => route.path)

    for (const { path } of EXPECTED_UNAUTH_ROUTES) {
      expect(topLevelPaths).not.toContain(path)
    }
  })
})
