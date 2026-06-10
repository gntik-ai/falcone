// Keycloak admin client for the control-plane (domain B).
//
// The repo's createTenant/user sagas are stubs (workflows/wf-con-002.mjs:
// createKeycloakRealm just returns a snapshot, no real call). So domain B needs a
// real admin client. This talks to the Keycloak admin REST API using the
// master-realm admin credentials (password grant, client admin-cli). Zero deps
// (native fetch). Falcone's tenancy model is realm-per-tenant: each tenant gets
// its own Keycloak realm (realm name == tenantId), per
// services/provisioning-orchestrator/src/reprovision/identifier-map.mjs::deriveIamRealm.
const BASE = (process.env.KEYCLOAK_BASE_URL || 'http://falcone-keycloak:8080').replace(/\/+$/, '');
const ADMIN_USER = process.env.KEYCLOAK_ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.KEYCLOAK_ADMIN_PASSWORD || '';

let cachedToken = null; // { token, exp }
async function adminToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 30 > now) return cachedToken.token;
  const res = await fetch(`${BASE}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: ADMIN_USER, password: ADMIN_PASS })
  });
  if (!res.ok) throw Object.assign(new Error(`keycloak admin token failed: ${res.status} ${await res.text()}`), { statusCode: 502 });
  const data = await res.json();
  cachedToken = { token: data.access_token, exp: now + (data.expires_in ?? 60) };
  return cachedToken.token;
}

async function kc(method, path, body) {
  const token = await adminToken();
  const res = await fetch(`${BASE}/admin${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    const err = new Error(`keycloak ${method} ${path} -> ${res.status}: ${typeof json === 'string' ? json : JSON.stringify(json)}`);
    err.statusCode = res.status; err.kcStatus = res.status; err.body = json;
    throw err;
  }
  // Keycloak returns 201 + Location header (no body) on creates; surface the id.
  const loc = res.headers.get('location');
  return { status: res.status, json, id: loc ? loc.split('/').pop() : undefined };
}

export const kcAdmin = {
  base: BASE,
  async realmExists(realm) {
    try { await kc('GET', `/realms/${encodeURIComponent(realm)}`); return true; }
    catch (e) { if (e.kcStatus === 404) return false; throw e; }
  },
  async createRealm({ realm, displayName, enabled = true }) {
    await kc('POST', '/realms', {
      realm, displayName: displayName ?? realm, enabled,
      loginWithEmailAllowed: true, registrationAllowed: false, rememberMe: true,
      resetPasswordAllowed: true, verifyEmail: false,
      attributes: { 'in-falcone.realm-type': 'tenant', 'in-falcone.control-plane.platform-realm': 'in-falcone-platform' }
    });
  },
  async deleteRealm(realm) { try { await kc('DELETE', `/realms/${encodeURIComponent(realm)}`); } catch (e) { if (e.kcStatus !== 404) throw e; } },
  async createRealmRole(realm, name) {
    try { await kc('POST', `/realms/${encodeURIComponent(realm)}/roles`, { name }); }
    catch (e) { if (e.kcStatus !== 409) throw e; } // 409 = already exists, fine
  },
  async getRealmRole(realm, name) { return (await kc('GET', `/realms/${encodeURIComponent(realm)}/roles/${encodeURIComponent(name)}`)).json; },
  async createUser(realm, { username, email, firstName, lastName, password, enabled = true, temporary = false }) {
    const created = await kc('POST', `/realms/${encodeURIComponent(realm)}/users`, {
      username, email, firstName, lastName, enabled, emailVerified: true,
      ...(password ? { credentials: [{ type: 'password', value: password, temporary }] } : {})
    });
    let id = created.id;
    if (!id) { // some KC versions omit Location; look up by username
      const found = (await kc('GET', `/realms/${encodeURIComponent(realm)}/users?username=${encodeURIComponent(username)}&exact=true`)).json;
      id = Array.isArray(found) && found[0] ? found[0].id : undefined;
    }
    return id;
  },
  async assignRealmRoles(realm, userId, roleNames) {
    const reps = [];
    for (const name of roleNames) reps.push(await this.getRealmRole(realm, name));
    await kc('POST', `/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(userId)}/role-mappings/realm`, reps);
  },
  async listUsers(realm, { max = 100 } = {}) {
    return (await kc('GET', `/realms/${encodeURIComponent(realm)}/users?max=${max}`)).json ?? [];
  },
  async deleteUser(realm, userId) { try { await kc('DELETE', `/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(userId)}`); } catch (e) { if (e.kcStatus !== 404) throw e; } },

  // ---- clients (service accounts = confidential client w/ service account) ----
  async findClient(realm, clientId) {
    const list = (await kc('GET', `/realms/${encodeURIComponent(realm)}/clients?clientId=${encodeURIComponent(clientId)}`)).json ?? [];
    return list[0] ?? null;
  },
  async createConfidentialClient(realm, { clientId, name, serviceAccountsEnabled = true }) {
    const created = await kc('POST', `/realms/${encodeURIComponent(realm)}/clients`, {
      clientId, name: name ?? clientId, enabled: true, protocol: 'openid-connect',
      publicClient: false, serviceAccountsEnabled, standardFlowEnabled: false, directAccessGrantsEnabled: false,
      attributes: { 'in-falcone.kind': 'service-account' }
    });
    let uuid = created.id;
    if (!uuid) { const c = await this.findClient(realm, clientId); uuid = c?.id; }
    return uuid;
  },
  async getClientSecret(realm, clientUuid) {
    return (await kc('GET', `/realms/${encodeURIComponent(realm)}/clients/${encodeURIComponent(clientUuid)}/client-secret`)).json?.value ?? null;
  },
  async regenerateClientSecret(realm, clientUuid) {
    return (await kc('POST', `/realms/${encodeURIComponent(realm)}/clients/${encodeURIComponent(clientUuid)}/client-secret`)).json?.value ?? null;
  },
  async setClientEnabled(realm, clientUuid, enabled) {
    await kc('PUT', `/realms/${encodeURIComponent(realm)}/clients/${encodeURIComponent(clientUuid)}`, { enabled });
  },
  async deleteClient(realm, clientUuid) { try { await kc('DELETE', `/realms/${encodeURIComponent(realm)}/clients/${encodeURIComponent(clientUuid)}`); } catch (e) { if (e.kcStatus !== 404) throw e; } },

  // ---- fine-grained IAM reads/writes (platform admin) ----------------------
  async listRealmRoles(realm) { return (await kc('GET', `/realms/${encodeURIComponent(realm)}/roles`)).json ?? []; },
  async deleteRealmRole(realm, name) { try { await kc('DELETE', `/realms/${encodeURIComponent(realm)}/roles/${encodeURIComponent(name)}`); } catch (e) { if (e.kcStatus !== 404) throw e; } },
  async listClients(realm) { return (await kc('GET', `/realms/${encodeURIComponent(realm)}/clients`)).json ?? []; },
  async listGroups(realm) { return (await kc('GET', `/realms/${encodeURIComponent(realm)}/groups`)).json ?? []; },
  async createGroup(realm, name) {
    const created = await kc('POST', `/realms/${encodeURIComponent(realm)}/groups`, { name });
    return created.id;
  },
  async deleteGroup(realm, groupId) { try { await kc('DELETE', `/realms/${encodeURIComponent(realm)}/groups/${encodeURIComponent(groupId)}`); } catch (e) { if (e.kcStatus !== 404) throw e; } },

  // ---- role assignment to users (fine-grained IAM) -------------------------
  async listUserRealmRoles(realm, userId) {
    return (await kc('GET', `/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(userId)}/role-mappings/realm`)).json ?? [];
  },
  async removeRealmRoles(realm, userId, roleNames) {
    const reps = [];
    for (const name of roleNames) reps.push(await this.getRealmRole(realm, name));
    await kc('DELETE', `/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(userId)}/role-mappings/realm`, reps);
  },

  // ---- group membership ----------------------------------------------------
  async addUserToGroup(realm, userId, groupId) {
    await kc('PUT', `/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(userId)}/groups/${encodeURIComponent(groupId)}`, {});
  },
  async removeUserFromGroup(realm, userId, groupId) {
    try { await kc('DELETE', `/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(userId)}/groups/${encodeURIComponent(groupId)}`); }
    catch (e) { if (e.kcStatus !== 404) throw e; }
  },
  async listGroupMembers(realm, groupId, { max = 200 } = {}) {
    return (await kc('GET', `/realms/${encodeURIComponent(realm)}/groups/${encodeURIComponent(groupId)}/members?max=${max}`)).json ?? [];
  },
  async listUserGroups(realm, userId) {
    return (await kc('GET', `/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(userId)}/groups`)).json ?? [];
  }
};

// The standard per-tenant realm roles (charts/in-falcone values: tenantRealmTemplate.requiredRealmRoles).
export const TENANT_REALM_ROLES = [
  'tenant_owner', 'tenant_admin', 'tenant_developer', 'tenant_viewer',
  'workspace_owner', 'workspace_admin', 'workspace_developer', 'workspace_operator',
  'workspace_auditor', 'workspace_viewer', 'workspace_service_account'
];
