import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { open, setup } from './consolePostgresData-support'

afterEach(() => cleanup())

// Port of apps/web-console form-control-legibility.test.tsx:78 (issue #806). Legacy asserted bg-background and text-foreground
// classes on the db / schema / table inputs; the kit Input carries the same token classes on its control element.
test('ConsolePostgresDataPage: db / schema / table inputs keep their ids and sit on the theme background with foreground text', () => {
  setup(); const { container } = open()
  for (const id of ['pg-db', 'pg-schema', 'pg-table']) {
    const input = container.querySelector(`#${id}`)
    expect(input, `control #${id} should be rendered`).not.toBeNull()
    expect(input!.className, `input #${id} must carry text-foreground`).toMatch(/text-foreground/)
    const surface = input!.closest('[class*="bg-"]')
    expect(surface?.className ?? input!.className, `control #${id} must sit on a theme background token`).toMatch(/bg-(background|transparent|card|muted)/)
  }
})
