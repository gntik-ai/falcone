import assert from 'node:assert/strict';
import { kcAdmin, CONTEXT_SCOPE_CLAIM_MAPPERS } from '../../../apps/control-plane/kc-admin.mjs';

export const W = 'workspace-one';
export const REALM = 'tenant-one';
export const ROLE = 'workspace_service_account';
export const MARKER = 'in-falcone.workspace-rollback';
export function fixture({ fail, failAt, afterCommit = false } = {}) {
  const calls = [];
  const writes = [];
  const state = {
    row: { id: 'sa-one', workspace_id: W, tenant_id: REALM, iam_realm: REALM,
      kc_client_id: 'sa-worker', kc_client_uuid: 'client-one', status: 'active',
      joined_workspace_id: W, workspace_tenant_id: REALM, joined_tenant_id: REALM, tenant_realm: REALM },
    client: { id: 'client-one', clientId: 'sa-worker', enabled: true, serviceAccountsEnabled: true,
      attributes: { 'in-falcone.kind': 'service-account', keep: 'yes' } },
    user: { id: 'user-one', attributes: { workspace_id: [W] } },
    mappers: [], defaults: [{ id: 'scope-one', name: 'workspace-context' }], optional: [],
    scopeMappers: { 'scope-one': structuredClone(CONTEXT_SCOPE_CLAIM_MAPPERS['workspace-context']) },
    roles: ['offline_access'], inheritedRoles: [], cutoff: null,
  };
  let failed = false;
  const step = (name, write, action = () => {}) => {
    calls.push(name);
    if (write) writes.push(name);
    const shouldFail = !failed && (fail === name || failAt === calls.length || state.failAt === calls.length);
    if (shouldFail && !afterCommit) { failed = true; throw new Error('private-provider-body secret-token'); }
    const result = action();
    if (shouldFail) { failed = true; throw new Error('private-provider-body secret-token'); }
    return structuredClone(result);
  };
  const kc = {
    listClients: async (realm) => { assert.equal(realm, REALM); return step('clients', false, () => [state.client, ...(state.unregistered ?? [])]); },
    getClient: async (realm, uuid) => { assert.equal(realm, REALM); assert.equal(uuid, 'client-one'); return step('client', false, () => state.client); },
    listClientMappers: async () => step('mappers', false, () => state.mappers),
    listClientDefaultScopes: async () => step('defaults', false, () => state.defaults),
    listClientOptionalScopes: async () => step('optional', false, () => state.optional),
    listScopeMappers: async (_realm, id) => step('scope-mappers', false, () => state.scopeMappers[id] ?? []),
    getServiceAccountUser: async () => step('user', false, () => state.user),
    listEffectiveRealmRoles: async () => step('roles', false, () => [...state.roles, ...state.inheritedRoles].map(name => ({ name }))),
    getRealmRole: async () => step('realm-role', false, () => ({ name: ROLE })),
    createRealmRole: async () => step('create-role', true),
    addHardcodedClaimMapper: async (_realm, _uuid, { name, claimName, claimValue }) => step('install', true, () => {
      state.mappers.push({ name, protocol: 'openid-connect', protocolMapper: 'oidc-hardcoded-claim-mapper', config: {
        'claim.name': claimName, 'claim.value': claimValue, 'jsonType.label': 'String',
        'access.token.claim': 'true', 'id.token.claim': 'true', 'userinfo.token.claim': 'true',
      } });
    }),
    ensureWorkspaceIdMapper: kcAdmin.ensureWorkspaceIdMapper,
    inspectWorkspaceClaimSources: async function (...args) { step('verify-claims', false); return kcAdmin.inspectWorkspaceClaimSources.apply(this, args); },
    removeClientDefaultScope: async (_realm, _uuid, id) => step('remove-default', true, () => { state.defaults = state.defaults.filter(scope => scope.id !== id); }),
    removeClientOptionalScope: async (_realm, _uuid, id) => step('remove-optional', true, () => { state.optional = state.optional.filter(scope => scope.id !== id); }),
    setClientEnabled: async (_realm, _uuid, enabled, attributes) => step(enabled ? 'enable' : 'disable', true, () => {
      state.client.enabled = enabled;
      if (attributes) state.client.attributes = attributes;
    }),
    assignRealmRoles: async (_realm, _user, roles) => step('assign', true, () => { state.roles.push(...roles); }),
    removeRealmRoles: async (_realm, _user, roles) => step('remove-role', true, () => { state.roles = state.roles.filter(role => !roles.includes(role)); }),
  };
  let transactionCutoff;
  const pool = {
    query: async (sql, values) => {
      if (sql.startsWith('SELECT id, iam_realm FROM tenants')) return { rows: [{ id: REALM, iam_realm: REALM }] };
      if (sql.includes('UPDATE service_accounts')) return step('cutoff', true, () => {
        state.cutoff = new Date(Math.max(state.cutoff?.getTime() ?? 0, values[1]?.getTime() ?? Date.now()));
        return { rows: [] };
      });
      if (sql === 'BEGIN') { transactionCutoff = state.cutoff; return { rows: [] }; }
      if (sql === 'ROLLBACK') { state.cutoff = transactionCutoff; return { rows: [] }; }
      if (sql === 'COMMIT') return { rows: [] };
      return step('registry', false, () => ({ rows: [state.row] }));
    },
    connect: async () => ({ query: pool.query, release() {} }),
  };
  const output = [];
  const options = { pool, kcAdmin: kc, outStream: { write: text => output.push(text) } };
  return { state, calls, writes, pool, kc, output, options };
}
