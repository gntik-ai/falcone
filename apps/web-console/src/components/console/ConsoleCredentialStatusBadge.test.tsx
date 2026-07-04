import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ConsoleCredentialStatusBadge } from './ConsoleCredentialStatusBadge'

afterEach(() => {
  cleanup()
})

// Faithful encoding of issue #783 scenario 2: WHEN the list shows service accounts in different
// credential states (active/rotated/revoked/expired) THEN each state is color-encoded via the
// existing badge-tone approach, not identical neutral pills. On main every status rendered as
// `<Badge variant="outline">` with no tone classes — these assertions fail there (RED).
describe('ConsoleCredentialStatusBadge (#783)', () => {
  it('color-encodes "active" as the emerald/healthy tone', () => {
    render(<ConsoleCredentialStatusBadge status="active" />)
    const badge = screen.getByText('active')
    expect(badge.className).toMatch(/emerald/)
  })

  it('color-encodes "revoked" as the red/destructive tone', () => {
    render(<ConsoleCredentialStatusBadge status="revoked" />)
    const badge = screen.getByText('revoked')
    expect(badge.className).toMatch(/red|destructive/)
  })

  it('color-encodes "expired" as the amber/warning tone', () => {
    render(<ConsoleCredentialStatusBadge status="expired" />)
    const badge = screen.getByText('expired')
    expect(badge.className).toMatch(/amber/)
  })

  it('color-encodes "rotated" with a tone distinct from active/revoked/expired', () => {
    render(<ConsoleCredentialStatusBadge status="rotated" />)
    const badge = screen.getByText('rotated')
    expect(badge.className).not.toMatch(/emerald/)
    expect(badge.className).not.toMatch(/red|destructive/)
    expect(badge.className).not.toMatch(/amber/)
  })

  it('the four known states each get a visually distinct tone (no identical neutral pills)', () => {
    const { unmount: unmountActive } = render(<ConsoleCredentialStatusBadge status="active" />)
    const activeClass = screen.getByText('active').className
    unmountActive()

    const { unmount: unmountRotated } = render(<ConsoleCredentialStatusBadge status="rotated" />)
    const rotatedClass = screen.getByText('rotated').className
    unmountRotated()

    const { unmount: unmountRevoked } = render(<ConsoleCredentialStatusBadge status="revoked" />)
    const revokedClass = screen.getByText('revoked').className
    unmountRevoked()

    const { unmount: unmountExpired } = render(<ConsoleCredentialStatusBadge status="expired" />)
    const expiredClass = screen.getByText('expired').className
    unmountExpired()

    const tones = [activeClass, rotatedClass, revokedClass, expiredClass]
    expect(new Set(tones).size).toBe(tones.length)
  })

  it('renders unknown/null status neutrally, without crashing', () => {
    render(<ConsoleCredentialStatusBadge status={null} />)
    expect(screen.getByText('Desconocido')).toBeInTheDocument()
  })

  it('renders an unrecognized status string neutrally rather than throwing', () => {
    render(<ConsoleCredentialStatusBadge status="some_future_state" />)
    expect(screen.getByText('some_future_state')).toBeInTheDocument()
  })
})
