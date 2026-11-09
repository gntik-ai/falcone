import assert from 'node:assert/strict'
import { loginSession, recordFetch, withSession } from './support.mjs'

const origin = 'https://synthetic.example.test'
const user = (id) => ({ userId: id, username: id, email: null, enabled: true })
const query = (url) => new URL(url, origin).searchParams

async function seed() {
  const { persistConsoleShellSession } = await import('@in-falcone/console-api/session')
  persistConsoleShellSession(loginSession())
}

export const iamAccessCases = [
  ['the users loader follows page.after until null and returns the whole collection', () => withSession(async () => {
    const { listAllIamRealmUsers } = await import('@in-falcone/console-api/iam')
    await seed()
    const requests = recordFetch((_, count) => Response.json(count === 1
      ? { items: [user('a'), user('b')], page: { after: 'synthetic-cursor' } }
      : { items: [user('c')], page: { after: null } }))
    const result = await listAllIamRealmUsers('synthetic-realm')
    assert.deepEqual(result.items.map((item) => item.userId), ['a', 'b', 'c'])
    assert.equal(result.total, 3)
    assert.equal(requests.length, 2)
    assert.deepEqual(requests.map(({ method }) => method), ['GET', 'GET'])
    assert.equal(new URL(requests[0].url, origin).pathname, '/v1/iam/realms/synthetic-realm/users')
    assert.equal(requests[0].url, '/v1/iam/realms/synthetic-realm/users?page%5Bsize%5D=200')
    assert.equal(requests[1].url, '/v1/iam/realms/synthetic-realm/users?page%5Bsize%5D=200&page%5Bafter%5D=synthetic-cursor')
    assert.equal(query(requests[1].url).get('page[size]'), '200')
  })],
  ['one response with page.after null sends one request', () => withSession(async () => {
    const { listAllIamRealmUsers } = await import('@in-falcone/console-api/iam')
    await seed()
    const requests = recordFetch(() => Response.json({ items: [user('a')], total: 23, page: { after: null } }))
    assert.equal((await listAllIamRealmUsers('synthetic-realm')).total, 23)
    assert.equal(requests.length, 1)
  })],
  ['a non-2xx continuation rejects without returning partial items', () => withSession(async () => {
    const { listAllIamRealmUsers } = await import('@in-falcone/console-api/iam')
    await seed()
    for (const status of [500, 502]) {
      recordFetch((_, count) => count === 1
        ? Response.json({ items: [user('a')], page: { after: 'synthetic-cursor' } })
        : Response.json({ code: `HTTP_${status}`, message: 'synthetic', requestId: 'synthetic-request' }, { status }))
      await assert.rejects(listAllIamRealmUsers('synthetic-realm'), (error) => error.status === status && error.requestId === 'synthetic-request')
    }
  })],
  ['a network failure on a continuation rejects without returning partial items', () => withSession(async () => {
    const { listAllIamRealmUsers } = await import('@in-falcone/console-api/iam')
    await seed()
    let calls = 0
    globalThis.fetch = async () => {
      calls += 1
      if (calls === 1) return Response.json({ items: [user('a')], page: { after: 'synthetic-cursor' } })
      throw new TypeError('Failed to fetch')
    }
    await assert.rejects(listAllIamRealmUsers('synthetic-realm'), TypeError)
    assert.equal(calls, 2)
  })],
  ['a repeated cursor rejects instead of looping', () => withSession(async () => {
    const { listAllIamRealmUsers } = await import('@in-falcone/console-api/iam')
    await seed()
    const requests = recordFetch(() => Response.json({ items: [user('a')], page: { after: 'synthetic-cursor' } }))
    await assert.rejects(listAllIamRealmUsers('synthetic-realm'), /Repeated users cursor/)
    assert.equal(requests.length, 2)
  })],
  ['IAM page clients keep the legacy method, path and body', () => withSession(async () => {
    const iam = await import('@in-falcone/console-api/iam')
    await seed()
    const requests = recordFetch(() => Response.json({}))
    await iam.listIamRealmRoles('synthetic-realm')
    await iam.listIamRealmGroups('synthetic-realm')
    await iam.listIamUserRoles('synthetic-realm', 'synthetic-user')
    await iam.listIamUserGroups('synthetic-realm', 'synthetic-user')
    await iam.createIamUser('synthetic-realm', { username: 'ada', email: 'ada@example.test', temporaryPassword: 'synthetic-secret', role: 'editor' })
    await iam.createIamUser('synthetic-realm', { username: 'bob' })
    await iam.createIamRole('synthetic-realm', 'support')
    await iam.createIamGroup('synthetic-realm', 'team')
    await iam.setIamUserStatus('synthetic-realm', 'synthetic-user', false)
    await iam.deleteIamUser('synthetic-realm', 'synthetic-user')
    assert.deepEqual(requests.map(({ method, url }) => `${method} ${url}`), [
      'GET /v1/iam/realms/synthetic-realm/roles',
      'GET /v1/iam/realms/synthetic-realm/groups',
      'GET /v1/iam/realms/synthetic-realm/users/synthetic-user/roles',
      'GET /v1/iam/realms/synthetic-realm/users/synthetic-user/groups',
      'POST /v1/iam/realms/synthetic-realm/users',
      'POST /v1/iam/realms/synthetic-realm/users',
      'POST /v1/iam/realms/synthetic-realm/roles',
      'POST /v1/iam/realms/synthetic-realm/groups',
      'PATCH /v1/iam/realms/synthetic-realm/users/synthetic-user/status',
      'DELETE /v1/iam/realms/synthetic-realm/users/synthetic-user'
    ])
    assert.deepEqual(JSON.parse(requests[4].body), { enabled: true, emailVerified: true, username: 'ada', email: 'ada@example.test', bootstrapCredentials: { temporaryPassword: 'synthetic-secret' }, realmRoles: ['editor'] })
    assert.deepEqual(JSON.parse(requests[5].body), { enabled: true, emailVerified: true, username: 'bob' })
    assert.deepEqual(JSON.parse(requests[6].body), { roleName: 'support' })
    assert.deepEqual(JSON.parse(requests[7].body), { name: 'team' })
    assert.deepEqual(JSON.parse(requests[8].body), { enabled: false })
    assert.equal(requests[9].body, undefined)
  })]
]
