import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  READ_ONLY_AFFORDANCE_BADGE_TONE,
  READ_ONLY_AFFORDANCE_TEXT_TONE,
  ReadOnlyActionBadge
} from './ReadOnlyActionBadge'

describe('ReadOnlyActionBadge (#761)', () => {
  it('renders the localized "Solo lectura · tu rol (…) no puede …" copy with a Lock cue', () => {
    render(
      <ReadOnlyActionBadge
        testId="demo-read-only-indicator"
        roleLabel="Viewer · solo lectura"
        deniedAction="crear flujos"
        reason="Contacta con un administrador de la organización."
      />
    )

    const badge = screen.getByTestId('demo-read-only-indicator')
    expect(badge).toHaveTextContent('Solo lectura · tu rol (Viewer · solo lectura) no puede crear flujos')
    // Lock icon present as a visual cue (aria-hidden, so screen readers rely on the text/recourse).
    expect(badge.querySelector('svg')).not.toBeNull()
  })

  it('applies the design-system dark-root amber tone (text-amber-300), not the dark-on-dark amber-700', () => {
    render(
      <ReadOnlyActionBadge testId="demo-read-only-indicator" roleLabel="Viewer · solo lectura" deniedAction="crear flujos" />
    )

    const badge = screen.getByTestId('demo-read-only-indicator')
    expect(badge.className).toMatch(/\btext-amber-300\b/)
    // The console never toggles `.dark`, so a dark-authored `-700` base (or a dead `dark:` variant)
    // would render dark-on-dark. Pin the tone so it cannot regress to the legacy pattern.
    expect(badge.className).not.toMatch(/amber-700/)
    expect(badge.className).not.toMatch(/dark:/)
  })

  it('exposes the recourse both to pointer users (title) and to assistive tech (sr-only child)', () => {
    const reason = 'Contacta con un administrador de la organización si necesitas este acceso.'
    render(
      <ReadOnlyActionBadge
        testId="demo-read-only-indicator"
        roleLabel="Viewer · solo lectura"
        deniedAction="crear flujos"
        reason={reason}
      />
    )

    const badge = screen.getByTestId('demo-read-only-indicator')
    expect(badge).toHaveAttribute('title', reason)
    // The reason is duplicated into an sr-only child so keyboard/touch/screen-reader users get the
    // same guidance a mouse-only `title` would hide from them.
    const srOnly = badge.querySelector('.sr-only')
    expect(srOnly).not.toBeNull()
    expect(srOnly).toHaveTextContent(reason)
  })

  it('accepts a className passthrough (e.g. w-fit) without dropping the shared tone', () => {
    render(
      <ReadOnlyActionBadge
        testId="demo-read-only-indicator"
        roleLabel="Viewer · solo lectura"
        deniedAction="crear flujos"
        className="w-fit"
      />
    )

    const badge = screen.getByTestId('demo-read-only-indicator')
    expect(badge.className).toMatch(/\bw-fit\b/)
    expect(badge.className).toMatch(/\btext-amber-300\b/)
  })

  it('keeps the badge and text tone tokens as one dark-root amber source of truth', () => {
    // Both surfaces (chip badges + inline/paragraph notices) must share the same dark-root amber so
    // the role badge, the page CTA-replacement badges and the ServiceAccounts notice never drift.
    expect(READ_ONLY_AFFORDANCE_BADGE_TONE).toContain('text-amber-300')
    expect(READ_ONLY_AFFORDANCE_BADGE_TONE).not.toContain('amber-700')
    expect(READ_ONLY_AFFORDANCE_BADGE_TONE).not.toContain('dark:')
    expect(READ_ONLY_AFFORDANCE_TEXT_TONE).toBe('text-amber-300')
  })
})
