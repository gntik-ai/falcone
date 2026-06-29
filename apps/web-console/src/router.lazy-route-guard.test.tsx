import { isValidElement, type ReactElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appRoutes } from './router'

// Render the real shell chrome as a thin <Outlet/> wrapper so the pathless errorElement route
// (and its content children) mount exactly as in production, without the shell's network/session
// machinery. ProtectedRoute is bypassed the same way the existing router.test.tsx does it.
vi.mock('@/components/auth/ProtectedRoute', () => ({ ProtectedRoute: () => <Outlet /> }))
vi.mock('@/layouts/ConsoleShellLayout', () => ({
  ConsoleShellLayout: () => (
    <div>
      <nav aria-label="primary-nav-stub">nav-chrome</nav>
      <Outlet />
    </div>
  )
}))
vi.mock('@/lib/console-session', () => ({
  readConsoleShellSession: () => ({ principal: { platformRoles: ['superadmin'] } })
}))
// The rotation page polls secret-rotation actions on mount; stub them so the behavioral render
// stays deterministic and offline.
vi.mock('@/actions/secretRotationActions', () => ({
  revokeSecretVersion: vi.fn().mockResolvedValue({}),
  initiateRotation: vi.fn().mockResolvedValue({}),
  listRotationHistory: vi.fn().mockResolvedValue({ items: [] }),
  getConsumerStatus: vi.fn().mockResolvedValue({ consumers: [] })
}))

afterEach(() => cleanup())

const REACT_LAZY = Symbol.for('react.lazy')

interface RouteNode {
  path?: string
  index?: boolean
  element?: ReactElement
  errorElement?: ReactElement
  children?: RouteNode[]
}

/** Depth-first: every route node in the tree, parents before children. */
function flatten(routes: RouteNode[]): RouteNode[] {
  const out: RouteNode[] = []
  for (const route of routes) {
    out.push(route)
    if (route.children) out.push(...flatten(route.children))
  }
  return out
}

/** The chain of ancestor routes (root → leaf) whose subtree contains a node matching `predicate`. */
function chainTo(
  routes: RouteNode[],
  predicate: (route: RouteNode) => boolean,
  trail: RouteNode[] = []
): RouteNode[] | null {
  for (const route of routes) {
    const here = [...trail, route]
    if (predicate(route)) return here
    if (route.children) {
      const found = chainTo(route.children, predicate, here)
      if (found) return found
    }
  }
  return null
}

function isLazyElement(element: ReactElement | undefined): boolean {
  if (!element || !isValidElement(element)) return false
  const type = element.type as { $$typeof?: symbol } | string | null | undefined
  return Boolean(type && typeof type === 'object' && type.$$typeof === REACT_LAZY)
}

const ROUTE_TREE = appRoutes as unknown as RouteNode[]

function findByPath(path: string): RouteNode {
  const node = flatten(ROUTE_TREE).find((route) => route.path === path)
  if (!node) throw new Error(`route with path "${path}" not found in appRoutes`)
  return node
}

describe('console secrets routes are eagerly importable (no synchronous-suspense crash) (#755)', () => {
  // ---- (a) Structural / audit guard: the genuine RED-on-main -> GREEN-on-branch gate. ----
  //
  // On `main` these two routes are wired with `element: <ConsoleSecretsPage />` where
  // `ConsoleSecretsPage = lazy(() => import(...))`. A React.lazy result is an exotic component whose
  // element `.type` carries `$$typeof === Symbol.for('react.lazy')`; reaching it through a
  // synchronous in-app `navigate()` (the Rotate/History buttons) suspends synchronously and throws
  // React #426, blanking the whole shell. After the fix the pages are eager top-level imports, so
  // `element.type` is a plain function component and this assertion holds. -> RED on main, GREEN here.

  it('the `secrets` route element is NOT a React.lazy component', () => {
    expect(isLazyElement(findByPath('secrets').element)).toBe(false)
  })

  it('the `secrets/:encodedSecretPath/rotate` route element is NOT a React.lazy component', () => {
    expect(isLazyElement(findByPath('secrets/:encodedSecretPath/rotate').element)).toBe(false)
  })

  it('control: the deliberately code-split `flows` route IS still a React.lazy component', () => {
    // Guards against a tautological test: the lazy-detection actually distinguishes lazy from eager.
    // Flows must stay lazy for the @xyflow canvas bundle (out of scope for #755).
    expect(isLazyElement(findByPath('flows').element)).toBe(true)
  })

  it('the console shell route chain exposes a shell-level errorElement', () => {
    // Requirement (#755): a route error must never replace the whole shell. The errorElement must
    // live on (or under) the ConsoleShellLayout route so a content-route error renders inside the
    // shell's Outlet with the nav chrome intact — not on the bare root boundary.
    const chain = chainTo(ROUTE_TREE, (route) => route.path === 'secrets')
    expect(chain).not.toBeNull()
    expect((chain ?? []).some((route) => isValidElement(route.errorElement))).toBe(true)
  })

  // ---- (b) Behavioral smoke test: clicking Rotate/History resolves the rotation page. ----
  //
  // NOTE: jsdom does not reproduce the browser's synchronous-suspense #426 throw identically, so
  // this is a smoke test (it is GREEN on main too once React resolves the lazy chunk). It documents
  // and locks in the end-to-end click -> rotation-page-render behavior. The RED->GREEN gate is the
  // structural guard above.

  it('clicking "Rotate" on a secrets row renders the rotation page inside the shell', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/console/secrets'] })
    render(<RouterProvider router={router} />)

    expect(await screen.findByRole('heading', { name: /secret rotation/i })).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: /^rotate$/i })[0])

    expect(await screen.findByRole('heading', { name: /rotate secret/i })).toBeInTheDocument()
    // The shell nav chrome is still mounted (no whole-shell blank), and no error boundary showed.
    expect(screen.getByRole('navigation', { name: /primary-nav-stub/i })).toBeInTheDocument()
    expect(screen.queryByTestId('console-route-error-boundary')).not.toBeInTheDocument()
  })

  it('clicking "History" on a secrets row renders the rotation/history page inside the shell', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/console/secrets'] })
    render(<RouterProvider router={router} />)

    expect(await screen.findByRole('heading', { name: /secret rotation/i })).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: /^history$/i })[0])

    expect(await screen.findByRole('heading', { name: /rotate secret/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /rotation history/i })).toBeInTheDocument()
    expect(screen.queryByTestId('console-route-error-boundary')).not.toBeInTheDocument()
  })
})
