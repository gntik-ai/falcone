import assert from 'node:assert/strict'
import { assertSyntheticFixture } from '../fixture-validator.mjs'
import { loginSession, recordFetch, withSession } from './support.mjs'

// Handler-shaped responses for the legacy IAM membership operations; all data is synthetic.
const fixtures = {
  'iam:assign-role-ok': {
    client: 'assignIamUserRoles',
    args: ['synthetic-realm/one', 'synthetic-user two', ['synthetic-reader', 'synthetic-editor']],
    method: 'POST',
    pathname: '/v1/iam/realms/synthetic-realm%2Fone/users/synthetic-user%20two/role-assignments',
    body: { roles: ['synthetic-reader', 'synthetic-editor'] },
    status: 201,
    payload: { userId: 'synthetic-user two', realm: 'synthetic-realm/one', assigned: ['synthetic-reader', 'synthetic-editor'] }
  },
  'iam:remove-role-ok': {
    client: 'removeIamUserRoles',
    args: ['synthetic-realm two', 'synthetic-user/one', ['synthetic-reader', 'synthetic-editor']],
    method: 'DELETE',
    pathname: '/v1/iam/realms/synthetic-realm%20two/users/synthetic-user%2Fone/role-assignments',
    body: { roles: ['synthetic-reader', 'synthetic-editor'] },
    status: 200,
    payload: { userId: 'synthetic-user/one', realm: 'synthetic-realm two', removed: ['synthetic-reader', 'synthetic-editor'] }
  },
  'iam:add-group-ok': {
    client: 'addIamUserToGroup',
    args: ['synthetic-realm/one', 'synthetic-user two', 'synthetic-group/three four?five#six%'],
    method: 'PUT',
    pathname: '/v1/iam/realms/synthetic-realm%2Fone/users/synthetic-user%20two/groups/synthetic-group%2Fthree%20four%3Ffive%23six%25',
    status: 201,
    payload: { userId: 'synthetic-user two', groupId: 'synthetic-group/three four?five#six%', realm: 'synthetic-realm/one', member: true }
  },
  'iam:remove-group-ok': {
    client: 'removeIamUserFromGroup',
    args: ['synthetic-realm two', 'synthetic-user/one', 'synthetic-group four/three'],
    method: 'DELETE',
    pathname: '/v1/iam/realms/synthetic-realm%20two/users/synthetic-user%2Fone/groups/synthetic-group%20four%2Fthree',
    status: 200,
    payload: { userId: 'synthetic-user/one', groupId: 'synthetic-group four/three', realm: 'synthetic-realm two', member: false }
  },
  'iam:membership-502': {
    status: 502,
    payload: { code: 'IAM_ASSIGN_ROLE_FAILED', message: 'Synthetic role assignment failure' }
  }
}

export const iamMembershipCases = [
  ...Object.entries(fixtures).filter(([, fixture]) => fixture.status < 400).map(([name, fixture]) => [
    `${name} preserves the membership request and response contract`, () => withSession(async () => {
      assertSyntheticFixture(fixture)
      const clients = await import('@in-falcone/console-api/clients')
      const { persistConsoleShellSession } = await import('@in-falcone/console-api/session')
      persistConsoleShellSession(loginSession())
      const requests = recordFetch(() => Response.json(fixture.payload, { status: fixture.status }))

      const result = await clients[fixture.client](...fixture.args)

      assert.deepEqual(result, fixture.payload)
      assert.equal(requests.length, 1)
      const [request] = requests
      const url = new URL(request.url, 'https://synthetic.example.test')
      assert.equal(request.method, fixture.method)
      assert.equal(url.pathname, fixture.pathname)
      assert.equal(url.search, '')
      assert.equal(url.hash, '')
      if (fixture.body === undefined) {
        assert.equal(request.body, undefined)
      } else {
        assert.deepEqual(JSON.parse(request.body), fixture.body)
      }
    })
  ]),
  ['iam:membership-502 rejects with the API error without retries or extra requests', () => withSession(async () => {
    const fixture = fixtures['iam:membership-502']
    assertSyntheticFixture(fixture)
    const { assignIamUserRoles } = await import('@in-falcone/console-api/clients')
    const { persistConsoleShellSession } = await import('@in-falcone/console-api/session')
    persistConsoleShellSession(loginSession())
    const requests = recordFetch(() => Response.json(fixture.payload, { status: fixture.status }))

    await assert.rejects(
      assignIamUserRoles('synthetic-realm', 'synthetic-user', ['synthetic-reader']),
      { status: 502, code: 'IAM_ASSIGN_ROLE_FAILED', message: 'Synthetic role assignment failure' }
    )
    assert.equal(requests.length, 1)
  })]
]
