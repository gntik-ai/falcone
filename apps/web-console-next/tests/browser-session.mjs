import { workspaceConsumptionEndpoints } from './parity/pages/console-workspace-dashboard-page.manifest.ts';
import { tenantMetricsEndpoints } from './parity/pages/consoleTenants.manifest.ts';
import { catalogEndpoints, catalogResponse, isPlansQuery } from './parity/pages/console-plan-catalog-page.manifest.ts';
import { allocationEndpoints } from './parity/pages/console-tenant-allocation-summary-page.manifest.ts';
import { createEndpointRegistry } from './parity/endpoint-registry.ts';
import { operationEndpoints } from './parity/pages/operationDetail.manifest.ts';
import { runtimeEndpoints } from './parity/pages/consoleRuntime.manifest.ts';
import { pendingEndpoints } from './parity/pages/pendingActivation.manifest.ts';
import { buildConsoleSignupPolicyFixture } from '@in-falcone/console-api/fixtures';

// Synthetic identities only. The app still exercises real session parsing and loaders.
export async function installSession(page, roles = ['superadmin']) {
  const unmatched = [];
  const endpoints = createEndpointRegistry({}, () => ({}), {
    ...(typeof tenantMetricsEndpoints === 'undefined' ? {} : tenantMetricsEndpoints), ...operationEndpoints, ...runtimeEndpoints, ...pendingEndpoints, ...(typeof catalogEndpoints === 'undefined' ? {} : catalogEndpoints), ...(typeof allocationEndpoints === 'undefined' ? {} : allocationEndpoints),
    ...(typeof workspaceConsumptionEndpoints === 'undefined' ? {} : workspaceConsumptionEndpoints),
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
    } else if (route.request().method() === 'GET' && /^\/v1\/workspaces\/[^/]+\/docs$/.test(url.pathname) && !url.search) {
      await route.fulfill({ json: {
        workspaceId: decodeURIComponent(url.pathname.split('/')[3]), tenantId: 'synthetic-tenant',
        baseUrl: 'https://synthetic-api.example.test', generatedAt: '2026-06-01T12:00:00Z',
        authInstructions: { method: 'synthetic-oidc', tokenEndpoint: null, clientIdPlaceholder: '<SYNTHETIC_CLIENT_ID>',
          clientSecretPlaceholder: '<SYNTHETIC_CLIENT_SECRET>', scopeHint: 'synthetic-scope', consoleRef: 'Synthetic console reference' },
        enabledServices: [], customNotes: [],
      } });
    } else {
      const request = route.request();
      let body;
      try { body = request.postDataJSON(); } catch { /* Invalid bodies remain unmatched. */ }
      const name = endpoints.find(request.method(), url.pathname, body);
      if (name === 'plans.list' && isPlansQuery(request.method(), url)) {
        const response = catalogResponse('45-mixed', url);
        await route.fulfill({ status: response.status, json: response.body });
        return;
      }
      if (name && name !== 'plans.list' && !url.search) {
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
