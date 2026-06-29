import { cleanup, render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RouteErrorBoundary } from './RouteErrorBoundary'

afterEach(() => cleanup())

function renderBoundaryFor(throwError: () => never) {
  const Boom = () => {
    throwError()
  }
  const router = createMemoryRouter(
    [
      {
        path: '/console',
        element: <div>shell</div>,
        children: [
          {
            errorElement: <RouteErrorBoundary />,
            children: [{ path: 'boom', element: <Boom /> }]
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
    renderBoundaryFor(() => {
      throw new Error('synthetic render failure with a secret-looking stack trace')
    })

    expect(screen.getByTestId('console-route-error-boundary')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    const backLink = screen.getByRole('link', { name: /volver a la consola/i })
    expect(backLink).toHaveAttribute('href', '/console/overview')

    // Never dump the raw thrown Error message / stack into the UI.
    expect(screen.queryByText(/synthetic render failure/i)).not.toBeInTheDocument()
    spy.mockRestore()
  })

  it('surfaces the status + message for a thrown route Response (data Response)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderBoundaryFor(() => {
      throw new Response('Acceso restringido', { status: 403, statusText: 'Forbidden' })
    })

    expect(screen.getByText(/error 403/i)).toBeInTheDocument()
    expect(screen.getByText(/acceso restringido/i)).toBeInTheDocument()
    spy.mockRestore()
  })
})
