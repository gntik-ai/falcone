import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PermissionDeniedNotice } from './PermissionDeniedNotice'

describe('PermissionDeniedNotice (#761)', () => {
  it('renders as an alert with the role-aware reason instead of a raw backend message', () => {
    render(<PermissionDeniedNotice reason="Tu rol (Viewer · solo lectura) permite consultar, no modificar." />)

    const alert = screen.getByRole('alert', { name: /acción restringida/i })
    expect(alert).toHaveTextContent(/tu rol \(viewer · solo lectura\) permite consultar, no modificar/i)
  })

  it('accepts a custom title', () => {
    render(<PermissionDeniedNotice title="Permiso denegado" reason="No tienes permisos para esta acción." />)

    expect(screen.getByRole('alert', { name: /permiso denegado/i })).toBeInTheDocument()
  })
})
