/**
 * Playwright page-proxy helper for the Flows E2E suite.
 *
 * GATEWAY GAP WORKAROUND (#374 deviation):
 *   /v1/flows/* APISIX route wiring is deferred. The web console serves on port 3000
 *   (nginx, no backend proxy) and calls /v1/... relative to its own origin. To reach
 *   the control-plane (port 8080) we intercept those relative calls with page.route().
 *
 * This function MUST be called before page.goto() so the interceptor is registered
 * before any navigation triggers API requests.
 *
 * The interceptor:
 *   - Rewrites /v1/* → http://localhost:8080/v1/* (or E2E_CP_BASE_URL)
 *   - Strips the console's `Authorization: Bearer` header (no JWT verifier in E2E)
 *   - Injects gateway-style identity headers (x-tenant-id, x-workspace-id, …) so the
 *     control-plane resolves the tenant from the trusted identity headers path
 *   - Forwards the response status + headers + body back to the page
 *   - Stubs /v1/tenants and /v1/workspaces to return the E2E fixture tenant/workspace
 *     so the ConsoleContextProvider resolves activeWorkspaceId without a real Keycloak
 *     principal.  The real control-plane only has E2E UUIDs — it returns 0 rows (the
 *     gateway identity is synthetic); stubbing avoids an empty drop-through that
 *     renders "Select a workspace" instead of the flows page.
 *
 * Auth-related paths (/v1/auth/*, /v1/console-auth/*) are proxied the same way
 * so Keycloak-backed login works without a gateway.
 */

import type { Page } from '@playwright/test'
import { controlPlaneBaseUrl, TENANT_A } from './tenant-fixtures'

/** Synthetic tenant entry returned to the console for the E2E identity. */
function syntheticTenantItem(identity: typeof TENANT_A) {
  return {
    tenantId: identity.tenantId,
    displayName: 'E2E Tenant',
    slug: 'e2e-tenant',
    state: 'active',
    provisioning: { status: 'complete' },
  }
}

/** Synthetic workspace entry returned to the console for the E2E identity. */
function syntheticWorkspaceItem(identity: typeof TENANT_A) {
  return {
    workspaceId: identity.workspaceId,
    tenantId: identity.tenantId,
    displayName: 'E2E Workspace',
    slug: 'e2e-workspace',
    environment: 'test',
    state: 'active',
    provisioning: { status: 'complete' },
  }
}

/**
 * Install the /v1/* → control-plane proxy on `page`. Call once per page, before goto().
 *
 * @param identity - Tenant identity to inject as gateway headers. Defaults to TENANT_A.
 * @returns A cleanup function (Playwright also cleans up on page close).
 */
export async function installApiProxy(
  page: Page,
  identity: typeof TENANT_A = TENANT_A,
): Promise<() => Promise<void>> {
  const cpBase = controlPlaneBaseUrl()

  await page.route(/^http:\/\/localhost:3000\/v1\//, async (route) => {
    const req = route.request()
    const originalUrl = req.url()

    // ----------------------------------------------------------------
    // Stub /v1/tenants — return the E2E fixture tenant so the console
    // context resolves activeTenantId without a real Keycloak session.
    // ----------------------------------------------------------------
    if (/\/v1\/tenants(\?|$)/.test(originalUrl)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [syntheticTenantItem(identity)],
          page: { after: null },
        }),
      })
      return
    }

    // ----------------------------------------------------------------
    // Stub /v1/workspaces — return the E2E fixture workspace.
    // ----------------------------------------------------------------
    if (/\/v1\/workspaces(\?|$)/.test(originalUrl)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [syntheticWorkspaceItem(identity)],
          page: { after: null },
        }),
      })
      return
    }

    // ----------------------------------------------------------------
    // Stub /v1/tenant/effective-capabilities — return workflows enabled.
    // ----------------------------------------------------------------
    if (/\/v1\/tenant\/effective-capabilities(\?|$)/.test(originalUrl) ||
        /\/v1\/tenants\/[^/]+\/effective-capabilities(\?|$)/.test(originalUrl)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          capabilities: { workflows: true, storage: true, functions: true, realtime: true },
        }),
      })
      return
    }

    // Replace the console origin (port 3000) with the control-plane origin (port 8080)
    const upstreamUrl = originalUrl.replace(/^http:\/\/localhost:3000/, cpBase)

    // Build proxied headers: strip the console's Bearer token (no JWT verifier in E2E),
    // inject gateway-style identity headers so the control-plane uses the headers path.
    const originalHeaders = req.headers()
    const proxiedHeaders: Record<string, string> = {}
    for (const [k, v] of Object.entries(originalHeaders)) {
      // Drop Authorization header — the control-plane would try to verify the JWT but
      // KEYCLOAK_JWKS_URL is not set in E2E, causing every request to return 401.
      if (k.toLowerCase() === 'authorization') continue
      proxiedHeaders[k] = v
    }
    // Inject the gateway-injected identity headers that the control-plane trusts.
    proxiedHeaders['x-tenant-id'] = identity.tenantId
    proxiedHeaders['x-workspace-id'] = identity.workspaceId
    proxiedHeaders['x-auth-subject'] = identity.actorId ?? 'e2e-actor'
    proxiedHeaders['x-pg-role'] = identity.roleName ?? 'falcone_app'

    try {
      const response = await page.request.fetch(upstreamUrl, {
        method: req.method(),
        headers: proxiedHeaders,
        data: req.postDataBuffer() ?? undefined,
      })
      await route.fulfill({
        status: response.status(),
        headers: Object.fromEntries(Object.entries(response.headers())),
        body: await response.body(),
      })
    } catch (err) {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'PROXY_ERROR', message: String(err) }),
      })
    }
  })

  return async () => {
    await page.unroute(/^http:\/\/localhost:3000\/v1\//)
  }
}

/**
 * Inject a fake console session into the page's sessionStorage so the ProtectedRoute
 * guard allows navigation to authenticated console pages without a real Keycloak login.
 *
 * Call this AFTER page.goto() on any page from the same origin (e.g. 'about:blank'
 * fails because sessionStorage is origin-scoped). Best used after a first goto to the
 * console root, then navigate to the protected route.
 *
 * Also seeds localStorage with the persisted console context (active tenant + workspace)
 * so the ConsoleContextProvider immediately has an activeWorkspaceId without waiting for
 * the /v1/tenants + /v1/workspaces round-trips.
 *
 * The injected session has:
 *   - authenticationState: 'active'
 *   - tokenSet.accessToken: a synthetic placeholder (the proxy strips the Bearer header)
 *   - expiresAt: 1 hour in the future
 */
export async function injectConsoleSession(
  page: Page,
  identity: typeof TENANT_A = TENANT_A,
): Promise<void> {
  const expiresAt = new Date(Date.now() + 3600_000).toISOString()
  const userId = `e2e-user-${identity.tenantId}`

  // The session shape must satisfy console-session.ts readConsoleShellSession() validation:
  //   - authenticationState: one of 'active' | 'pending_activation' | 'suspended' | ...
  //   - statusView: must be in isValidConsoleStatusView ('login' | 'signup' | ...)
  //   - tokenSet: must pass isValidTokenSet (accessToken, refreshToken, expiresAt,
  //     refreshExpiresAt, expiresIn: number, refreshExpiresIn: number, scope, tokenType)
  const session = {
    sessionId: `e2e-session-${identity.tenantId}`,
    authenticationState: 'active',
    // 'login' is in the valid statusView set — use it as the "current view" status.
    statusView: 'login',
    issuedAt: new Date().toISOString(),
    expiresAt,
    refreshExpiresAt: expiresAt,
    principal: {
      // userId is required for ConsoleContextProvider to load tenants.
      userId,
      displayName: 'E2E Test User',
      username: 'e2e-user',
      primaryEmail: 'e2e@test.local',
    },
    tokenSet: {
      accessToken: 'e2e-placeholder-access-token',
      refreshToken: 'e2e-placeholder-refresh-token',
      expiresAt,
      refreshExpiresAt: expiresAt,
      // Required numeric fields for isValidTokenSet
      expiresIn: 3600,
      refreshExpiresIn: 3600,
      scope: 'openid profile email',
      tokenType: 'Bearer',
    },
  }

  // Persisted context (localStorage) — pre-selects tenant + workspace so the console
  // does not render "Select a workspace" on first navigation.
  const activeContext = {
    userId,
    tenantId: identity.tenantId,
    workspaceId: identity.workspaceId,
    updatedAt: new Date().toISOString(),
  }

  await page.evaluate(
    ([sessionKey, sessionValue, contextKey, contextValue]) => {
      sessionStorage.setItem(sessionKey as string, JSON.stringify(sessionValue))
      localStorage.setItem(contextKey as string, JSON.stringify(contextValue))
    },
    [
      'in-falcone.console-shell-session',
      session,
      'in-falcone.console-active-context',
      activeContext,
    ] as [string, unknown, string, unknown],
  )
}
