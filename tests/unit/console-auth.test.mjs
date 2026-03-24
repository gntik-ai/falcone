import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONSOLE_AUTH_STATUS_VIEWS,
  consoleAuthApiFamily,
  getConsoleAuthRoute,
  listConsoleAuthRoutes,
  summarizeConsoleAuthSurface
} from '../../apps/control-plane/src/console-auth.mjs';

test('console auth helper exposes the expanded auth family surface', () => {
  const routes = listConsoleAuthRoutes();
  const publicRoutes = listConsoleAuthRoutes({ authRequired: false });
  const summary = summarizeConsoleAuthSurface();

  assert.equal(consoleAuthApiFamily?.id, 'auth');
  assert.ok(routes.some((route) => route.path === '/v1/auth/login-sessions'));
  assert.ok(routes.some((route) => route.path === '/v1/auth/signups'));
  assert.ok(routes.some((route) => route.path === '/v1/auth/password-recovery-requests'));
  assert.ok(publicRoutes.some((route) => route.path === '/v1/auth/status-views/{statusViewId}'));
  assert.equal(getConsoleAuthRoute('createConsoleLoginSession')?.path, '/v1/auth/login-sessions');
  assert.deepEqual(CONSOLE_AUTH_STATUS_VIEWS, [
    'login',
    'signup',
    'pending_activation',
    'account_suspended',
    'credentials_expired',
    'password_recovery'
  ]);
  assert.equal(summary.publicRouteCount >= 7, true);
  assert.equal(summary.protectedRouteCount >= 2, true);
});
