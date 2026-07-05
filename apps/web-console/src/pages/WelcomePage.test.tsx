import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { WelcomePage } from './WelcomePage'

describe('WelcomePage', () => {
  it('renderiza el contenido de bienvenida de la consola', () => {
    render(
      <MemoryRouter>
        <WelcomePage />
      </MemoryRouter>
    )

    const heading = screen.getByRole('heading', { level: 1, name: /in falcone console/i })
    expect(heading).toBeInTheDocument()
    expect(screen.getByText(/consola de administración para tu organización/i)).toBeInTheDocument()
    expect(screen.getByText(/bienvenido a la consola/i)).toBeInTheDocument()
    expect(screen.queryByText(/\bshell\b/i)).not.toBeInTheDocument()
    // Every pre-auth destination is reachable from the welcome hub (login ⇄ signup ⇄ recovery).
    expect(screen.getByRole('link', { name: /ir al login/i })).toHaveAttribute('href', '/login')
    expect(screen.getByRole('link', { name: /solicitar acceso/i })).toHaveAttribute('href', '/signup')
    expect(screen.getByRole('link', { name: /¿olvidaste tu contraseña\?/i })).toHaveAttribute(
      'href',
      '/password-recovery'
    )
  })

  it('[#730] no muestra artefactos internos de scaffolding (badges EP/US, rutas /v1/, notas de roadmap)', () => {
    render(
      <MemoryRouter>
        <WelcomePage />
      </MemoryRouter>
    )

    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/EP-\d+\s*\/\s*US-UI/i)
    expect(text).not.toMatch(/\/v1\//)
    expect(text).not.toMatch(/llegarán en T\d/i)
    expect(text).not.toMatch(/fundación de consola lista/i)
    expect(screen.queryByText(/stack confirmado/i)).not.toBeInTheDocument()
  })
})
