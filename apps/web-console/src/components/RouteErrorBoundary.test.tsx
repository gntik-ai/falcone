import type { ReactElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { Outlet, RouterProvider, createMemoryRouter, type LoaderFunction } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RouteErrorBoundary } from './RouteErrorBoundary'

afterEach(() => cleanup())

/**
 * Mount the leaf `boom` route under a pathless `errorElement` route so a failure renders the
 * RouteErrorBoundary, mirroring production (`ConsoleShellLayout`'s `<Outlet/>` wraps the content
 * routes whose pathless layout carries the boundary).
 *
 * Two harness rules are load-bearing — keep them:
 *  1. The PARENT layout route MUST render an `<Outlet/>`. In react-router a child route (and its
 *     `errorElement`) only mounts when an ancestor route renders an `<Outlet/>`; a parent that
 *     returns bare `<div>shell</div>` never mounts `boom`, so it never throws and the boundary is
 *     never reached. (Same reason the sibling router.lazy-route-guard.test.tsx mocks the shell to
 *     `<div>…<Outlet /></div>`.) We keep the literal "shell" text so the boundary is shown to
 *     render *inside* the shell chrome.
 *  2. A thrown `Response` must come from a `loader`, NOT from render. `isRouteErrorResponse()`
 *     (used by the component to pick the "Error {status}" branch) only returns true for a
 *     react-router-normalized `ErrorResponse`, which is produced solely when a Response is thrown
 *     from a loader/action — a raw Response thrown during render has neither `.internal` nor
 *     `.data` and is treated as a generic error. Because loaders are async, that test awaits
 *     `screen.findByText(...)`.
 */
function renderBoundaryFor(leaf: { element?: ReactElement; loader?: LoaderFunction }) {
  const router = createMemoryRouter(
    [
      {
        path: '/console',
        element: (
          <div>
            shell
            <Outlet />
          </div>
        ),
        children: [
          {
            errorElement: <RouteErrorBoundary />,
            children: [
              {
                path: 'boom',
                element: leaf.element ?? <div>boom-ok</div>,
                loader: leaf.loader
              }
            ]
          }
        ]
      }
    ],
    { initialEntries: ['/console/boom'] }
  )
  return render(<RouterProvider router={router} />)
}

describe('RouteErrorBoundary (#755)', () => {
  it('renders a contained, on-brand error region with a back-to-console affordance', () => {
    // React logs the caught render error to console.error — silence it for a clean test run.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Boom = (): never => {
      throw new Error('synthetic render failure with a secret-looking stack trace')
    }
    renderBoundaryFor({ element: <Boom /> })

    expect(screen.getByTestId('console-route-error-boundary')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    const backLink = screen.getByRole('link', { name: /volver a la consola/i })
    expect(backLink).toHaveAttribute('href', '/console/overview')

    // Never dump the raw thrown Error message / stack into the UI.
    expect(screen.queryByText(/synthetic render failure/i)).not.toBeInTheDocument()
    spy.mockRestore()
  })

  it('surfaces the status + message for a thrown route Response (data Response)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Throw from the loader so react-router normalizes it to an ErrorResponse (status 403,
    // data = await response.text() = 'Acceso restringido'); only then does isRouteErrorResponse()
    // return true and the component renders the "Error 403" branch.
    const loader: LoaderFunction = () => {
      throw new Response('Acceso restringido', { status: 403, statusText: 'Forbidden' })
    }
    renderBoundaryFor({ loader })

    expect(await screen.findByText(/error 403/i)).toBeInTheDocument()
    expect(screen.getByText(/acceso restringido/i)).toBeInTheDocument()
    spy.mockRestore()
  })
})
