import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertSyntheticFixture } from '../fixture-validator.mjs'
import { snapshot } from './support.mjs'

export const fixtureCases = [
  ['exported fixtures contain only synthetic credentials or the legacy inventory metadata', async () => {
    const fixtures = await import('@in-falcone/console-api/fixtures')
    const expected = [
      'buildConsoleAccountStatusViewFixture', 'buildConsoleLoginSessionFixture',
      'buildConsolePasswordRecoveryFixture', 'buildConsoleRefreshSessionFixture',
      'buildConsoleSessionTerminationFixture', 'buildConsoleSignupFixture',
      'buildConsoleSignupPolicyFixture', 'buildTenantCollectionFixture', 'buildTenantFixture',
      'buildWorkspaceCollectionFixture', 'buildWorkspaceFixture', 'buildPlatformSecretInventoryFixture'
    ]
    assert.deepEqual(Object.keys(fixtures).sort(), expected.sort())
    for (const [name, builder] of Object.entries(fixtures)) {
      const fixture = builder()
      assert.ok(fixture && typeof fixture === 'object')
      if (name === 'buildPlatformSecretInventoryFixture') {
        // Paths are metadata, not credentials. Exact legacy paths and rows are
        // checked in platform-secret-inventory.test.ts; check all other fields here.
        for (const { secretPath, ...metadata } of fixture) {
          assert.equal(typeof secretPath, 'string')
          assertSyntheticFixture(secretPath)
          assertSyntheticFixture(metadata)
        }
      } else {
        assertSyntheticFixture(fixture)
      }
    }
    assertSyntheticFixture(snapshot)
    const dataDirectory = join(dirname(fileURLToPath(import.meta.url)), '../data')
    for (const file of readdirSync(dataDirectory, { recursive: true })) {
      if (file.endsWith('.json')) assertSyntheticFixture(JSON.parse(readFileSync(join(dataDirectory, file), 'utf8')))
    }
    assert.equal(fixtures.buildConsoleLoginSessionFixture().tokenSet.accessToken, 'synthetic-access-token')
    assert.equal(fixtures.buildConsolePasswordRecoveryFixture().credentialPolicy.recoveryTokenTtl, 'PT15M')
    const first = fixtures.buildConsoleLoginSessionFixture()
    first.tokenSet.accessToken = 'synthetic-modified'
    assert.equal(fixtures.buildConsoleLoginSessionFixture().tokenSet.accessToken, 'synthetic-access-token')
  }],
  ['validator accepts synthetic credential strings and the defined policy suffixes', async () => {
    assert.doesNotThrow(() => assertSyntheticFixture({
      accessToken: 'synthetic-a', tokenType: 'Bearer', recoveryTokenTtl: 'PT15M', passwordMaxAge: 'P90D',
      refreshTokenExpiresAt: '2099-01-01T00:00:00Z', refreshTokenExpiresIn: 'PT1H',
      nested: [{ secret: 'synthetic-secret', apiKey: 'synthetic-key', credential: 'synthetic-credential' }]
    }))
  }],
  ...[
    { ordinary: 'flc_anon_testvalue' }, { nested: ['/x?apikey=y'] }, { ordinary: '/x?APIKEY=y' },
    { refreshToken: 'abc' }, [{ password: 'x' }], { nested: { apiKey: 'abc' } },
    { secret: 'abc' }, { credential: 'abc' }, { accessToken: ['abc'] },
    { ordinary: 'eyJsynthetic' }, { accessTokenExpiresAt: 'eyJsynthetic' }, { tokenType: 'synthetic-bearer' }
  ].map((value, index) => [`validator rejects unsafe fixture case ${index + 1}`, async () => {
    assert.throws(() => assertSyntheticFixture(value))
  }])
]
