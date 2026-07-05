// Round-2 live-check fix (#757): the console never mounts `.dark` — the dark palette IS the
// `:root` (globals.css) — so a `text-X-700 dark:text-X-300` tone pair renders its light-mode
// `-700` variant on the near-black background (~3.4-3.5:1, below WCAG AA 4.5:1). FlowStatusBadge
// renders on ConsoleFlowsPage, a screen this branch (#757) migrated onto the shared Table
// primitive, so it falls under the branch's own dark-root rule (same class of fix as the
// PostgresDataEditor/MongoDataEditor/ConsolePostgresPage/ConsoleMongoPage tones already
// converged). Pin the draft ("Borrador") and published ("Publicado") tones for the dark root.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FlowStatusBadge } from './FlowStatusBadge'

describe('FlowStatusBadge', () => {
  it('authors the draft ("Borrador") tone for the dark root (text-amber-300, not the light-mode -700 pair)', () => {
    render(<FlowStatusBadge status="draft" />)

    const badge = screen.getByTestId('flow-status-badge')
    expect(badge).toHaveTextContent('Borrador')
    expect(badge.className).toMatch(/text-amber-300/)
    expect(badge.className).not.toMatch(/amber-700/)
    // border/bg pill structure is preserved — only the text tone changed.
    expect(badge.className).toMatch(/border-amber-500\/30/)
    expect(badge.className).toMatch(/bg-amber-500\/10/)
  })

  it('authors the published ("Publicado") tone for the dark root (text-emerald-300, not the light-mode -700 pair)', () => {
    render(<FlowStatusBadge status="published" />)

    const badge = screen.getByTestId('flow-status-badge')
    expect(badge).toHaveTextContent('Publicado')
    expect(badge.className).toMatch(/text-emerald-300/)
    expect(badge.className).not.toMatch(/emerald-700/)
    expect(badge.className).toMatch(/border-emerald-500\/30/)
    expect(badge.className).toMatch(/bg-emerald-500\/10/)
  })
})
