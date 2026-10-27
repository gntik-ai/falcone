import { createEndpointRegistry } from './parity/endpoint-registry.ts';
import { operationEndpoints } from './parity/pages/operationDetail.manifest.ts';
import { runtimeEndpoints } from './parity/pages/consoleRuntime.manifest.ts';
import { pendingEndpoints } from './parity/pages/pendingActivation.manifest.ts';
import { buildConsoleSignupPolicyFixture } from '@in-falcone/console-api/fixtures';

// Synthetic identities only. The app still exercises real session parsing and loaders.
export async function installSession(page, roles = ['superadmin']) {
  const unmatched = [];
  const endpoints = createEndpointRegistry({}, () => ({}), {
    ...operationEndpoints, ...runtimeEndpoints, ...pendingEndpoints,
    signupPolicy: { method: 'GET', path: '/v1/auth/signups/policy', fixtures: {
      success: { status: 200, body: buildConsoleSignupPolicyFixture() },
    } },
  });
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
      const request = route.request();
      let body;
      try { body = request.postDataJSON(); } catch { /* Invalid bodies remain unmatched. */ }
      const name = endpoints.find(request.method(), url.pathname, body);
      if (name && !url.search) {
        const response = endpoints.responseFor(name, 'superadmin', body);
        await route.fulfill({ status: response.status, json: response.body });
        return;
      }
      unmatched.push(route.request().method() + ' ' + url.pathname + url.search);
      await route.abort();
    }
  });
  return unmatched;
}
