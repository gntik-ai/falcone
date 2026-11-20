import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import * as api from '@in-falcone/console-api'
import type { PlatformSecretInventoryRow } from '@in-falcone/console-api'

// Independent rows captured from ConsoleSecretsPage at base 69296937330b61be2bbf2c7267520196499fc038.
const expected: PlatformSecretInventoryRow[] = JSON.parse(readFileSync(new URL('./fixtures/legacy-platform-secret-inventory.json', import.meta.url), 'utf8'))

describe('static platform secret inventory', () => {
  it('exports the exact legacy rows in order without fetching', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('static source must not fetch') })
    try {
      expect(api.buildPlatformSecretInventoryFixture()).toEqual(expected)
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      fetch.mockRestore()
    }
  })

  it('returns fresh rows so consumers cannot modify the shared static source', () => {
    const rows = api.buildPlatformSecretInventoryFixture()
    rows[0].name = 'changed'
    rows.reverse()
    expect(api.buildPlatformSecretInventoryFixture()).toEqual(expected)
  })
})
