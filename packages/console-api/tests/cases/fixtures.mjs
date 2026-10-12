import assert from 'node:assert/strict'
import { assertSyntheticFixture } from '../fixture-validator.mjs'
import { snapshot } from './support.mjs'

export const fixtureCases = [
  ['each exported fixture builder returns synthetic data, including the base snapshot', async () => {
    const fixtures = await import('@in-falcone/console-api/fixtures')
    const expected = [
      'buildConsoleAccountStatusViewFixture', 'buildConsoleLoginSessionFixture',
      'buildConsolePasswordRecoveryFixture', 'buildConsoleRefreshSessionFixture',
      'buildConsoleSessionTerminationFixture', 'buildConsoleSignupFixture',
      'buildConsoleSignupPolicyFixture', 'buildTenantCollectionFixture', 'buildTenantFixture',
      'buildWorkspaceCollectionFixture', 'buildWorkspaceFixture'
    ]
    assert.deepEqual(Object.keys(fixtures).sort(), expected.sort())
    for (const builder of Object.values(fixtures)) {
      const fixture = builder()
      assert.ok(fixture && typeof fixture === 'object')
      assertSyntheticFixture(fixture)
    }
    assertSyntheticFixture(snapshot)
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
    { refreshToken: 'abc' }, [{ password: 'x' }], { nested: { apiKey: 'abc' } },
    { secret: 'abc' }, { credential: 'abc' }, { accessToken: ['abc'] },
    { ordinary: 'eyJsynthetic' }, { accessTokenExpiresAt: 'eyJsynthetic' }, { tokenType: 'synthetic-bearer' }
  ].map((value, index) => [`validator rejects unsafe fixture case ${index + 1}`, async () => {
    assert.throws(() => assertSyntheticFixture(value))
  }])
]
