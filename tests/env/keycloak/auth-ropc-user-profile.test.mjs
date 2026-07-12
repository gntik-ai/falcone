// Real-Keycloak-26 proof for fix-auth-as-a-service-login (#496).
//
// Keycloak 26's declarative user profile marks email/firstName/lastName REQUIRED for role
// "user". A platform user provisioned via the admin API without those fails Direct Access Grant
// (ROPC) with invalid_grant "Account is not fully set up" — EVEN with requiredActions:[] — so no
// newly-created principal but the bootstrap superadmin can authenticate. The fix relaxes the
// realm's user profile so those attributes are optional; the chart bootstrap PUTs the same
// config (../falcone-charts/charts/in-falcone: bootstrap.oneShot.keycloak.userProfile +
// templates/bootstrap-script-configmap.yaml::ensure_keycloak_user_profile) and the runtime does
// the same for tenant realms (apps/control-plane/kc-admin.mjs::relaxUserProfile). This
// proves the mechanism end-to-end against a real KC 26: RED before the relax, GREEN after.
//
// Run via tests/env/keycloak/run.sh (brings up the tests/env Keycloak 26 on :8081).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const KC = process.env.KC_BASE_URL ?? 'http://localhost:8081';
const ADMIN_USER = process.env.KC_ADMIN ?? 'admin';
const ADMIN_PW = process.env.KC_ADMIN_PASSWORD ?? 'admin';
const REALM = 'auth_ropc_probe';
const CLIENT = 'in-falcone-console';
const PW = 'Passw0rd!';

let token;

async function adminToken() {
  const res = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: ADMIN_USER, password: ADMIN_PW }),
  });
  if (!res.ok) throw new Error(`admin token failed: ${res.status}`);
  return (await res.json()).access_token;
}
const api = (method, path, body) => fetch(`${KC}${path}`, {
  method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});
async function createUser(user) {
  const res = await api('POST', `/admin/realms/${REALM}/users`, user);
  if (res.status !== 201 && res.status !== 409) throw new Error(`createUser ${user.username} → ${res.status}`);
}
// Returns 'OK' on a token, or the Keycloak error_description on failure (e.g. the bug string).
async function ropc(username) {
  const res = await fetch(`${KC}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: CLIENT, scope: 'openid', username, password: PW }),
  });
  const j = await res.json();
  return j.access_token ? 'OK' : (j.error_description ?? j.error ?? 'unknown_error');
}
// The relaxation the chart bootstrap / kc-admin applies: KC26's default profile with `required`
// stripped from email/firstName/lastName.
async function relaxUserProfile() {
  const prof = await (await api('GET', `/admin/realms/${REALM}/users/profile`)).json();
  for (const a of prof.attributes ?? []) {
    if (['email', 'firstName', 'lastName'].includes(a.name)) delete a.required;
  }
  const res = await api('PUT', `/admin/realms/${REALM}/users/profile`, prof);
  assert.equal(res.status, 200, 'user profile PUT accepted');
}

before(async () => {
  token = await adminToken();
  // Guarantee a FRESH realm (default KC26 user profile) so the RED baseline is deterministic on
  // re-run: delete, then poll until the realm is gone, then create (must be a fresh 201).
  await api('DELETE', `/admin/realms/${REALM}`);
  for (let i = 0; i < 30; i++) {
    if ((await api('GET', `/admin/realms/${REALM}`)).status === 404) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const create = await api('POST', '/admin/realms', {
    realm: REALM, enabled: true, loginWithEmailAllowed: true, registrationAllowed: true,
    rememberMe: true, verifyEmail: true, resetPasswordAllowed: true,
  });
  assert.equal(create.status, 201, 'fresh realm created (not reusing a relaxed one)');
  // The platform console client: public + Direct Access Grants (ROPC), mirrors the chart.
  await api('POST', `/admin/realms/${REALM}/clients`, {
    clientId: CLIENT, enabled: true, publicClient: true, bearerOnly: false,
    standardFlowEnabled: true, directAccessGrantsEnabled: true, serviceAccountsEnabled: false,
  });
  // bareuser: NO firstName/lastName/email (what the admin API / a minimal signup produces).
  await createUser({ username: 'bareuser', enabled: true, emailVerified: true, credentials: [{ type: 'password', value: PW, temporary: false }] });
  // emailuser: an email but no name — the common admin-created platform principal.
  await createUser({ username: 'emailuser', email: 'e@example.com', enabled: true, emailVerified: true, credentials: [{ type: 'password', value: PW, temporary: false }] });
});

// Single deterministic sequence (RED → relax → GREEN) — no cross-test shared mutable realm state.
test('default KC26 profile blocks ROPC (RED); relaxing email/firstName/lastName fixes it (GREEN)', async () => {
  assert.equal(await ropc('bareuser'), 'Account is not fully set up', 'RED: reproduces the live invalid_grant');

  await relaxUserProfile();

  assert.equal(await ropc('bareuser'), 'OK', 'GREEN: name/email-less principal can now obtain a token');
  assert.equal(await ropc('emailuser'), 'OK', 'GREEN: admin-created (email, no name) principal can authenticate');
});
