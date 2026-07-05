import { cleanup, render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import { AuthLayout } from './AuthLayout'

// Mirrors the unauthenticated route table in router.tsx (path + handle.title) without pulling in
// the real page components (and their network calls) — AuthLayout itself is the unit under test.
const UNAUTH_ROUTE_TABLE = [
  { path: '/', title: 'Bienvenida · Consola In Falcone', content: 'Welcome content' },
  { path: '/login', title: 'Acceso · Consola In Falcone', content: 'Login content' },
  { path: '/password-recovery', title: 'Recuperar contraseña · Consola In Falcone', content: 'Recovery content' },
  { path: '/signup', title: 'Solicitar acceso · Consola In Falcone', content: 'Signup content' },
  {
    path: '/signup/pending-activation',
    title: 'Registro pendiente · Consola In Falcone',
    content: 'Pending content'
  },
  { path: '/does-not-exist', title: 'Página no encontrada · Consola In Falcone', content: 'Not found content' }
] as const

function buildAuthLayoutChildren() {
  return UNAUTH_ROUTE_TABLE.map(({ path, title, content }) => ({
    path: path === '/does-not-exist' ? '*' : path,
    element: <div>{content}</div>,
    handle: { title }
  }))
}

function renderAuthLayoutRoute(initialEntry: string) {
  const router = createMemoryRouter(
    [
      {
        element: <AuthLayout />,
        children: buildAuthLayoutChildren()
      }
    ],
    { initialEntries: [initialEntry] }
  )

  return render(<RouterProvider router={router} />)
}

describe('AuthLayout [#731]', () => {
  afterEach(() => cleanup())

  describe.each(UNAUTH_ROUTE_TABLE)('route $path', ({ path, title, content }) => {
    it(`sets document.title to "${title}"`, async () => {
      renderAuthLayoutRoute(path)

      expect(await screen.findByText(content)).toBeInTheDocument()
      expect(document.title).toBe(title)
    })

    it('renders the In Falcone brand mark', async () => {
      renderAuthLayoutRoute(path)

      await screen.findByText(content)
      expect(screen.getByRole('img', { name: /in falcone/i })).toHaveAttribute('src', '/img/logo-wide.png')
    })

    it('renders the shared header landmark and single container', async () => {
      renderAuthLayoutRoute(path)

      await screen.findByText(content)
      expect(screen.getByRole('banner')).toBeInTheDocument()
      expect(screen.getByTestId('auth-shell-container')).toHaveClass('max-w-5xl')
    })
  })

  it('on the welcome hub ("/"): the brand mark is not a self-link, and "Volver al inicio de sesión" points to login', async () => {
    renderAuthLayoutRoute('/')
    await screen.findByText('Welcome content')

    expect(screen.queryByRole('link', { name: /volver al inicio de in falcone console/i })).not.toBeInTheDocument()
    const backToLogin = screen.getByRole('link', { name: /volver al inicio de sesión/i })
    expect(backToLogin).toHaveAttribute('href', '/login')
  })

  it('on /login: the brand mark is the persistent way back home, and there is no self-link to login', async () => {
    renderAuthLayoutRoute('/login')
    await screen.findByText('Login content')

    expect(screen.queryByRole('link', { name: /volver al inicio de sesión/i })).not.toBeInTheDocument()
    const brandHomeLink = screen.getByRole('link', { name: /volver al inicio de in falcone console/i })
    expect(brandHomeLink).toHaveAttribute('href', '/')
  })

  it.each([
    ['/password-recovery', 'Recovery content'],
    ['/signup', 'Signup content'],
    ['/signup/pending-activation', 'Pending content'],
    ['/does-not-exist', 'Not found content']
  ])('on %s: both the brand-mark home link and the "Volver al inicio de sesión" link are present', async (path, content) => {
    renderAuthLayoutRoute(path)
    await screen.findByText(content)

    expect(screen.getByRole('link', { name: /volver al inicio de in falcone console/i })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /volver al inicio de sesión/i })).toHaveAttribute('href', '/login')
  })

  it('[#731] moving between routes updates the title with no abrupt structural change (same header/container stay mounted)', async () => {
    const router = createMemoryRouter(
      [
        {
          element: <AuthLayout />,
          children: [
            { path: '/', element: <div>Welcome content</div>, handle: { title: 'Bienvenida · Consola In Falcone' } },
            { path: '/login', element: <div>Login content</div>, handle: { title: 'Acceso · Consola In Falcone' } }
          ]
        }
      ],
      { initialEntries: ['/'] }
    )

    render(<RouterProvider router={router} />)
    await screen.findByText('Welcome content')
    expect(document.title).toBe('Bienvenida · Consola In Falcone')
    const headerBeforeNavigation = screen.getByRole('banner')

    router.navigate('/login')

    await screen.findByText('Login content')
    expect(document.title).toBe('Acceso · Consola In Falcone')
    // Same header element instance stays mounted across the route change (AuthLayout itself never
    // unmounts/remounts when moving within the unauthenticated funnel).
    expect(screen.getByRole('banner')).toBe(headerBeforeNavigation)
  })
})
