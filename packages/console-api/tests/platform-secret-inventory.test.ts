import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import * as api from '@in-falcone/console-api'
import type { PlatformSecretInventoryRow } from '@in-falcone/console-api'

const expected: PlatformSecretInventoryRow[] = [
  { secretPath: 'platform/postgresql/app-password', name: 'app-password', domain: 'platform', tenant: '—', state: 'active', lastRotated: '2026-03-31T00:00:00Z', vaultVersion: 2, requiresForce: false },
  { secretPath: 'tenant/tenant-a/db-password', name: 'db-password', domain: 'organización', tenant: 'org-a', state: 'grace', lastRotated: '2026-03-30T12:00:00Z', vaultVersion: 1, requiresForce: true }
]

describe('static platform secret inventory', () => {
  it('exports the exact legacy rows in order without fetching', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('static source must not fetch') })
    try {
      expect(api.buildPlatformSecretInventoryFixture()).toEqual(expected)
      // Independent rows captured from ConsoleSecretsPage at base 69296937330b61be2bbf2c7267520196499fc038.
      const frozen = JSON.parse(readFileSync(new URL('./fixtures/legacy-platform-secret-inventory.json', import.meta.url), 'utf8'))
      expect(frozen).toEqual(expected)
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
