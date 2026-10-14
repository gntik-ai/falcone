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
      // Independently compare the fixture against the legacy page, without importing React.
      const legacy = readFileSync(new URL('../../../apps/web-console/src/pages/ConsoleSecretsPage.tsx', import.meta.url), 'utf8')
      const rows = legacy.match(/const \[items\] = useState\((\[[\s\S]*?\])\)/)?.[1]
      expect(rows).toBeDefined()
      expect(Function(`return (${rows})`)()).toEqual(expected)
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
