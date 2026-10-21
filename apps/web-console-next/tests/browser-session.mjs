import { readdir } from 'node:fs/promises';

// Synthetic identities only. The app still exercises real session parsing and loaders.

// Migrated pages answer their own requests for suites that visit every concrete route (the
// CSP spec). Each tests/session-fixtures/<page-id>.mjs default-exports an array of
// { method, path, json } or { method, path, respond(request) => json | undefined } entries
// with synthetic data only, so a page migration adds one file and changes neither this helper
// nor the CSP spec. Entries for one method and path are tried in file-name order: a respond
// returning undefined passes the request on, and a second static json entry for the same
// method and path is an error. Only callers passing { pageFixtures: true } use them; any
// request no entry answers still aborts and is reported unmatched.
const PAGE_FIXTURES = new URL('./session-fixtures/', import.meta.url);

async function loadPageFixtures() {
  let names = [];
  try {
    names = (await readdir(PAGE_FIXTURES)).filter((name) => name.endsWith('.mjs')).sort();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const fixtures = [];
  const staticOwners = new Map();
  for (const name of names) {
    for (const entry of (await import(new URL(name, PAGE_FIXTURES).href)).default) {
      if (!entry.respond) {
        const key = entry.method + ' ' + entry.path;
        if (staticOwners.has(key)) throw new Error(`session fixture ${key} is defined in both ${staticOwners.get(key)} and ${name}`);
        staticOwners.set(key, name);
      }
      fixtures.push(entry);
    }
  }
  return fixtures;
}

async function answer(fixtures, request, pathname) {
  for (const entry of fixtures) {
    if (entry.method !== request.method() || entry.path !== pathname) continue;
    const json = entry.respond ? await entry.respond(request) : entry.json;
    if (json !== undefined) return json;
  }
  return undefined;
}

export async function installSession(page, roles = ['superadmin'], { pageFixtures = false } = {}) {
  const unmatched = [];
  const fixtures = pageFixtures ? await loadPageFixtures() : [];
  await page.addInitScript((platformRoles) => {
    sessionStorage.setItem('in-falcone.console-shell-session', JSON.stringify({
      sessionId: 'synthetic-session', authenticationState: 'active', statusView: 'active',
      issuedAt: '2026-01-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z', refreshExpiresAt: '2099-01-02T00:00:00Z',
      tokenSet: { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', tokenType: 'Bearer', scope: 'openid',
        expiresAt: '2099-01-01T00:00:00Z', expiresIn: 3600, refreshExpiresAt: '2099-01-02T00:00:00Z', refreshExpiresIn: 86400 },
      principal: { userId: 'synthetic-user', username: 'synthetic-user', displayName: 'Synthetic Operator',
        primaryEmail: 'synthetic@example.test', state: 'active', platformRoles, tenantIds: [], workspaceIds: [] }
    }));
  }, roles);
  await page.route('**/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET' && url.pathname === '/v1/tenants' && url.search === '?page%5Bsize%5D=100&sort=displayName') {
      await route.fulfill({ json: { items: [], page: { after: null } } });
    } else {
      const json = await answer(fixtures, route.request(), url.pathname);
      if (json !== undefined) {
        await route.fulfill({ json });
        return;
      }
      unmatched.push(route.request().method() + ' ' + url.pathname + url.search);
      await route.abort();
    }
  });
  return unmatched;
}
