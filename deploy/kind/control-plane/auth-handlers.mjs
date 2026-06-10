// Domain B — console auth endpoints (login/refresh/logout/signup-policy).
//
// The SPA's LoginPage calls these (apps/web-console/src/lib/console-auth.ts);
// the repo ships no implementation. We back them with Keycloak ROPC against the
// platform realm + public console client, returning the ConsoleLoginSession
// shape the SPA expects. Handler contract: async (ctx) => { statusCode, body }.
import { randomUUID } from 'node:crypto';
import { kcAdmin } from './kc-admin.mjs';
const KC_BASE = (process.env.KEYCLOAK_BASE_URL || 'http://falcone-keycloak:8080').replace(/\/+$/, '');
const REALM = process.env.CONSOLE_AUTH_REALM || 'in-falcone-platform';
const CLIENT = process.env.CONSOLE_AUTH_CLIENT_ID || 'in-falcone-console';
const SELF_SERVICE = (process.env.CONSOLE_SIGNUP_SELF_SERVICE ?? 'true') === 'true';
const ok = (statusCode, body) => ({ statusCode, body });
const errBody = (statusCode, code, message) => ({ statusCode, body: { code, message, statusView: 'login' } });

function decodeJwt(token) {
  try { const p = token.split('.')[1]; return JSON.parse(Buffer.from(p, 'base64url').toString()); } catch { return {}; }
}
function isoIn(secs) { return new Date(Date.now() + secs * 1000).toISOString(); }

function sessionFromTokenResponse(data, sessionId) {
  const claims = decodeJwt(data.access_token);
  const roles = claims?.realm_access?.roles ?? [];
  const platformRoles = roles.filter((r) => /^(superadmin|platform_|tenant_|workspace_)/.test(r));
  return {
    sessionId,
    authenticationState: 'active',
    statusView: 'login',
    issuedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    expiresAt: isoIn(data.expires_in ?? 300),
    idleExpiresAt: isoIn(data.expires_in ?? 300),
    refreshExpiresAt: isoIn(data.refresh_expires_in ?? 1800),
    sessionPolicy: {},
    tokenSet: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? '',
      expiresAt: isoIn(data.expires_in ?? 300),
      refreshExpiresAt: isoIn(data.refresh_expires_in ?? 1800),
      expiresIn: data.expires_in ?? 300,
      refreshExpiresIn: data.refresh_expires_in ?? 1800,
      scope: data.scope ?? 'openid',
      tokenType: 'Bearer'
    },
    principal: {
      displayName: claims.name ?? claims.preferred_username ?? 'User',
      primaryEmail: claims.email ?? '',
      state: 'active',
      userId: claims.sub ?? '',
      username: claims.preferred_username ?? '',
      platformRoles,
      tenantIds: claims.tenant_id ? [claims.tenant_id] : [],
      workspaceIds: claims.workspace_id ? [claims.workspace_id] : []
    }
  };
}

async function kcToken(form) {
  const res = await fetch(`${KC_BASE}/realms/${encodeURIComponent(REALM)}/protocol/openid-connect/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form)
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// POST /v1/auth/login-sessions  (PUBLIC) — ROPC login.
async function login(ctx) {
  const { body } = ctx;
  if (!body.username || !body.password) return errBody(400, 'VALIDATION_ERROR', 'username and password are required');
  const r = await kcToken({ grant_type: 'password', client_id: CLIENT, scope: 'openid', username: body.username, password: body.password });
  if (!r.ok) {
    const desc = r.data.error_description || r.data.error || 'authentication failed';
    return errBody(401, 'INVALID_CREDENTIALS', desc);
  }
  return ok(201, sessionFromTokenResponse(r.data, randomId()));
}

// POST /v1/auth/login-sessions/{sessionId}/refresh  (PUBLIC) — refresh tokens.
async function refresh(ctx) {
  const { body, params } = ctx;
  if (!body.refreshToken) return errBody(400, 'VALIDATION_ERROR', 'refreshToken is required');
  const r = await kcToken({ grant_type: 'refresh_token', client_id: CLIENT, refresh_token: body.refreshToken });
  if (!r.ok) return errBody(401, 'REFRESH_FAILED', r.data.error_description || 'refresh failed');
  return ok(200, sessionFromTokenResponse(r.data, params.sessionId || randomId()));
}

// DELETE /v1/auth/login-sessions/{sessionId}  (authenticated) — logout.
async function logout(ctx) {
  // Best-effort: Keycloak logout needs the refresh token; the SPA only sends the
  // access token here, so we accept the termination (the token expires shortly).
  return ok(200, { sessionId: ctx.params.sessionId, status: 'accepted', acceptedAt: new Date().toISOString() });
}

// GET /v1/auth/signups/policy  (PUBLIC) — self-service registration policy.
async function signupPolicy() {
  return ok(200, {
    selfServiceEnabled: SELF_SERVICE,
    mode: SELF_SERVICE ? 'self_service' : 'invitation',
    statusView: 'signup',
    passwordPolicy: { minLength: 8 },
    message: SELF_SERVICE ? 'Self-service signup is enabled.' : 'Signup is invitation-only in this deployment.'
  });
}

// POST /v1/auth/signups  (PUBLIC) — self-service account creation in the
// platform realm. Creates an enabled Keycloak user with the supplied password so
// the account can immediately log in (ConsoleSignupRegistration shape).
async function signup(ctx) {
  const { body } = ctx;
  if (!SELF_SERVICE) return errBody(403, 'SIGNUP_DISABLED', 'Self-service signup is disabled');
  const username = body.username ?? body.primaryEmail;
  if (!username || !body.password) return errBody(400, 'VALIDATION_ERROR', 'username and password are required');
  try {
    const userId = await kcAdmin.createUser(REALM, {
      username, email: body.primaryEmail ?? null,
      firstName: (body.displayName ?? username).split(' ')[0],
      lastName: (body.displayName ?? '').split(' ').slice(1).join(' ') || 'User',
      password: body.password, enabled: true, temporary: false
    });
    return ok(201, {
      registrationId: randomUUID(), userId, activationMode: 'self_service', state: 'active',
      statusView: 'login', createdAt: new Date().toISOString(),
      message: 'Account created. You can now sign in.'
    });
  } catch (e) {
    if (e.kcStatus === 409) return errBody(409, 'USERNAME_TAKEN', 'That username or email is already registered');
    return errBody(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'SIGNUP_FAILED', String(e.message ?? e));
  }
}

function randomId() { return 'cs_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }

export const AUTH_HANDLERS = { login, refresh, logout, signupPolicy, signup };
