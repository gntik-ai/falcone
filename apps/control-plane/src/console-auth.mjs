import {
  filterPublicRoutes,
  getApiFamily,
  getPublicRoute
} from '../../../services/internal-contracts/src/index.mjs';

export const consoleAuthApiFamily = getApiFamily('auth');
export const consoleAuthRoutes = filterPublicRoutes({ family: 'auth' });
export const CONSOLE_AUTH_STATUS_VIEWS = Object.freeze([
  'login',
  'signup',
  'pending_activation',
  'account_suspended',
  'credentials_expired',
  'password_recovery'
]);

export function listConsoleAuthRoutes(filters = {}) {
  return filterPublicRoutes({ family: 'auth', ...filters });
}

export function getConsoleAuthRoute(operationId) {
  const route = getPublicRoute(operationId);
  return route?.family === 'auth' ? route : undefined;
}

export function summarizeConsoleAuthSurface() {
  const publicRoutes = consoleAuthRoutes.filter((route) => route.authRequired === false);
  const protectedRoutes = consoleAuthRoutes.filter((route) => route.authRequired === true);

  return {
    family: consoleAuthApiFamily?.id ?? 'auth',
    routeCount: consoleAuthRoutes.length,
    publicRouteCount: publicRoutes.length,
    protectedRouteCount: protectedRoutes.length,
    statusViews: [...CONSOLE_AUTH_STATUS_VIEWS]
  };
}
