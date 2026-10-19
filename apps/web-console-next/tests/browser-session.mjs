// Synthetic identities only. The app still exercises real session parsing and loaders.
export async function installSession(page, roles = ['superadmin']) {
  const unmatched = [];
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
      unmatched.push(route.request().method() + ' ' + url.pathname + url.search);
      await route.abort();
    }
  });
  return unmatched;
}
