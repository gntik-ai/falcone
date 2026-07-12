/**
 * Falcone official (first-party) MCP server — curated tool catalog
 * (change: add-mcp-official-server, #391; epic #386; completeness: add-control-mcp-completeness, #642).
 *
 * A CURATED-but-comprehensive subset of the platform management surface, exposed as MCP tools —
 * NOT a 1:1 export of every route. Tool PATHS target the routes the runtime ACTUALLY serves
 * (apps/control-plane/routes.mjs for control-plane families + the executor's own routes for
 * api-keys/embedding), reached via the executor's local routing + control-plane fallthrough. Read
 * tools (GET) need only the base `mcp:invoke` scope; mutating tools (POST/PUT/DELETE) each carry an
 * explicit per-tool scope and are refused without it (read-first, design.md).
 *
 * Tenant scoping (ADR-2): the `{tenantId}` path segment is ALWAYS substituted from the
 * credential-derived identity, NEVER from a tool argument. Other path params (`{workspaceId}`,
 * `{serviceAccountId}`, …) are resource ids supplied as tool arguments within the caller's tenant.
 *
 * Each tool: { name, description, inputSchema, mutates, scope, method, path, family, kind }.
 *   kind: 'proxy'      → the call is dispatched as a REST request (default)
 *         'authoring'  → handled in-process by the deterministic planner (mcp-authoring.mjs)
 *         'config-get' → returns the live MCP configuration (mcp-config.mjs)
 *         'config-set' → mutates the MCP configuration (superadmin-only)
 */

export const BASE_SCOPE = 'mcp:invoke';

/** @typedef {{name:string,description:string,inputSchema:object,mutates:boolean,scope:(string|null),method:string,path:(string|null),family:string,kind:string,superadminOnly?:boolean}} McpTool */

const obj = (props = {}, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });

// A proxied management tool. `scope` null ⇒ read tool (base scope only); a string ⇒ mutating tool.
const tool = (name, description, { method, path, family, inputSchema = obj(), scope = null }) => ({
  name, description, inputSchema, method, path, family, kind: 'proxy', mutates: scope != null, scope,
});

/** @type {McpTool[]} */
export const OFFICIAL_TOOLS = [
  // ── Workspaces ──────────────────────────────────────────────────────────────
  tool('list_workspaces',
    'List every workspace in the current tenant with its slug, environment and status. Read-only; use this first to discover where data and resources live before acting.',
    { method: 'GET', path: '/v1/workspaces', family: 'workspaces' }),
  tool('get_workspace',
    'Get one workspace by id (slug, environment, status, provisioned resources). Read-only.',
    { method: 'GET', path: '/v1/workspaces/{workspaceId}', family: 'workspaces',
      inputSchema: obj({ workspaceId: str('The workspace id.') }, ['workspaceId']) }),
  tool('create_workspace',
    'Create a new workspace (project environment) in the current tenant. MUTATING — requires the mcp:falcone:workspaces:write scope.',
    { method: 'POST', path: '/v1/tenants/{tenantId}/workspaces', family: 'workspaces', scope: 'mcp:falcone:workspaces:write',
      inputSchema: obj({ slug: str('URL-safe workspace slug.'), name: str('Human-readable workspace name.'), environment: str('Environment, e.g. dev/staging/prod.') }, ['slug']) }),
  tool('delete_workspace',
    'Delete a workspace and cascade-clean its resources (database, buckets, topics, credentials). MUTATING — requires the mcp:falcone:workspaces:write scope.',
    { method: 'DELETE', path: '/v1/workspaces/{workspaceId}', family: 'workspaces', scope: 'mcp:falcone:workspaces:write',
      inputSchema: obj({ workspaceId: str('The workspace id to delete.') }, ['workspaceId']) }),

  // ── Tenant (own project), users & auth config ────────────────────────────────
  tool('get_tenant',
    'Get the current tenant (project) record. Read-only; the tenant is resolved from the credential.',
    { method: 'GET', path: '/v1/tenants/{tenantId}', family: 'tenant' }),
  tool('list_environments',
    'List the environments (stages) configured for the current tenant. Read-only.',
    { method: 'GET', path: '/v1/tenants/{tenantId}/environments', family: 'tenant' }),
  tool('list_tenant_users',
    'List the operator users of the current tenant (the people who manage the project). Read-only.',
    { method: 'GET', path: '/v1/tenants/{tenantId}/users', family: 'users' }),
  tool('create_tenant_user',
    'Invite/create an operator user in the current tenant. MUTATING — requires the mcp:falcone:users:write scope.',
    { method: 'POST', path: '/v1/tenants/{tenantId}/users', family: 'users', scope: 'mcp:falcone:users:write',
      inputSchema: obj({ email: str('User email.'), role: str('Operator role to grant, e.g. tenant_owner.') }, ['email']) }),
  tool('get_auth_config',
    'Get the current tenant project\'s authentication configuration (enabled methods, social identity providers). Read-only.',
    { method: 'GET', path: '/v1/tenants/{tenantId}/auth-config', family: 'auth' }),
  tool('set_auth_config',
    'Update the tenant project\'s authentication configuration (enable auth methods). MUTATING — requires the mcp:falcone:auth-config:write scope.',
    { method: 'PUT', path: '/v1/tenants/{tenantId}/auth-config', family: 'auth', scope: 'mcp:falcone:auth-config:write',
      inputSchema: obj({ passwordEnabled: { type: 'boolean', description: 'Enable email/password sign-in.' }, registrationAllowed: { type: 'boolean', description: 'Allow self-service sign-up.' } }) }),

  // ── Service accounts & credentials ───────────────────────────────────────────
  tool('list_service_accounts',
    'List the service accounts of a workspace (machine identities). Read-only.',
    { method: 'GET', path: '/v1/workspaces/{workspaceId}/service-accounts', family: 'service-accounts',
      inputSchema: obj({ workspaceId: str('The workspace id.') }, ['workspaceId']) }),
  tool('create_service_account',
    'Create a service account (machine identity) in a workspace. MUTATING — requires the mcp:falcone:service-accounts:write scope.',
    { method: 'POST', path: '/v1/workspaces/{workspaceId}/service-accounts', family: 'service-accounts', scope: 'mcp:falcone:service-accounts:write',
      inputSchema: obj({ workspaceId: str('The workspace id.'), name: str('Service-account name.') }, ['workspaceId', 'name']) }),
  tool('issue_service_account_credential',
    'Reveal the current client secret for a service account. MUTATING — requires the mcp:falcone:credentials:write scope. Use rotation to replace the secret.',
    { method: 'POST', path: '/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-issuance', family: 'service-accounts', scope: 'mcp:falcone:credentials:write',
      inputSchema: obj({ workspaceId: str('The workspace id.'), serviceAccountId: str('The service-account id.') }, ['workspaceId', 'serviceAccountId']) }),

  // ── Databases ────────────────────────────────────────────────────────────────
  tool('get_database',
    'Get the provisioned database for a workspace (engine, connection metadata). Read-only.',
    { method: 'GET', path: '/v1/workspaces/{workspaceId}/database', family: 'databases',
      inputSchema: obj({ workspaceId: str('The workspace id.') }, ['workspaceId']) }),
  tool('provision_database',
    'Provision a database (postgresql | mongodb) for a workspace. MUTATING — requires the mcp:falcone:databases:write scope.',
    { method: 'POST', path: '/v1/workspaces/{workspaceId}/databases', family: 'databases', scope: 'mcp:falcone:databases:write',
      inputSchema: obj({ workspaceId: str('The workspace id.'), engine: str('Database engine: postgresql or mongodb.') }, ['workspaceId', 'engine']) }),

  // ── Functions registry ───────────────────────────────────────────────────────
  tool('list_functions',
    'List the serverless functions registered in a workspace. Read-only.',
    { method: 'GET', path: '/v1/workspaces/{workspaceId}/functions', family: 'functions',
      inputSchema: obj({ workspaceId: str('The workspace id.') }, ['workspaceId']) }),
  tool('register_function',
    'Register (deploy) a serverless function in a workspace. MUTATING — requires the mcp:falcone:functions:write scope.',
    { method: 'POST', path: '/v1/workspaces/{workspaceId}/functions', family: 'functions', scope: 'mcp:falcone:functions:write',
      inputSchema: obj({ workspaceId: str('The workspace id.'), name: str('Function name.'), runtime: str('Runtime, e.g. nodejs.') }, ['workspaceId', 'name']) }),

  // ── Quotas & entitlements ────────────────────────────────────────────────────
  tool('get_effective_capabilities',
    'Get the plan-derived capability flags for the current tenant (which features are enabled). Read-only.',
    { method: 'GET', path: '/v1/tenant/effective-capabilities', family: 'quotas' }),
  tool('get_effective_entitlements',
    'Get the full entitlement + consumption profile (limits and usage) for the current tenant. Read-only; check headroom before provisioning more.',
    { method: 'GET', path: '/v1/tenant/plan/effective-entitlements', family: 'quotas' }),
  tool('list_workspace_sub_quotas',
    'List the per-workspace sub-quota allocations within the tenant\'s plan. Read-only.',
    { method: 'GET', path: '/v1/workspace-sub-quotas', family: 'quotas' }),
  tool('set_workspace_sub_quota',
    'Set a per-workspace sub-quota allocation. MUTATING — requires the mcp:falcone:quotas:write scope.',
    { method: 'POST', path: '/v1/workspace-sub-quotas', family: 'quotas', scope: 'mcp:falcone:quotas:write',
      inputSchema: obj({ workspaceId: str('The workspace id.'), dimension: str('Quota dimension key.'), limit: { type: 'number', description: 'The sub-quota limit for the dimension.' } }, ['workspaceId', 'dimension', 'limit']) }),

  // ── Observability / metrics (read-only) ──────────────────────────────────────
  tool('get_tenant_quotas',
    'Get the current tenant\'s quota limits and usage. Read-only.',
    { method: 'GET', path: '/v1/metrics/tenants/{tenantId}/quotas', family: 'observability' }),
  tool('get_tenant_overview',
    'Get a usage/health overview for the current tenant. Read-only.',
    { method: 'GET', path: '/v1/metrics/tenants/{tenantId}/overview', family: 'observability' }),

  // ── Storage ──────────────────────────────────────────────────────────────────
  tool('list_buckets',
    'List the object-storage buckets visible to the current tenant. Read-only.',
    { method: 'GET', path: '/v1/storage/buckets', family: 'storage' }),
  tool('provision_bucket',
    'Provision an object-storage bucket for a workspace. MUTATING — requires the mcp:falcone:storage:write scope.',
    { method: 'POST', path: '/v1/storage/workspaces/{workspaceId}/buckets', family: 'storage', scope: 'mcp:falcone:storage:write',
      inputSchema: obj({ workspaceId: str('The workspace id.'), name: str('Bucket name.') }, ['workspaceId', 'name']) }),

  // ── Events ───────────────────────────────────────────────────────────────────
  tool('list_event_topics',
    'List the event topics provisioned for a workspace (Kafka inventory). Read-only.',
    { method: 'GET', path: '/v1/events/workspaces/{workspaceId}/inventory', family: 'events',
      inputSchema: obj({ workspaceId: str('The workspace id.') }, ['workspaceId']) }),
  tool('provision_topic',
    'Provision an event topic for a workspace. MUTATING — requires the mcp:falcone:events:write scope.',
    { method: 'POST', path: '/v1/events/workspaces/{workspaceId}/topics', family: 'events', scope: 'mcp:falcone:events:write',
      inputSchema: obj({ workspaceId: str('The workspace id.'), name: str('Topic name.') }, ['workspaceId', 'name']) }),

  // ── Webhooks (workspace-addressed) ───────────────────────────────────────────
  tool('list_webhook_subscriptions',
    'List the outbound webhook subscriptions for a workspace. Read-only.',
    { method: 'GET', path: '/v1/workspaces/{workspaceId}/webhooks/subscriptions', family: 'webhooks',
      inputSchema: obj({ workspaceId: str('The workspace id.') }, ['workspaceId']) }),
  tool('create_webhook_subscription',
    'Create an outbound webhook subscription for a workspace. MUTATING — requires the mcp:falcone:webhooks:write scope.',
    { method: 'POST', path: '/v1/workspaces/{workspaceId}/webhooks/subscriptions', family: 'webhooks', scope: 'mcp:falcone:webhooks:write',
      inputSchema: obj({ workspaceId: str('The workspace id.'), url: str('Destination HTTPS URL.'), eventTypes: { type: 'array', items: { type: 'string' }, description: 'Event types to subscribe to.' } }, ['workspaceId', 'url']) }),

  // ── API keys (executor-served) ───────────────────────────────────────────────
  tool('list_api_keys',
    'List the API keys issued for a workspace. Read-only (key material is not returned).',
    { method: 'GET', path: '/v1/workspaces/{workspaceId}/api-keys', family: 'api-keys',
      inputSchema: obj({ workspaceId: str('The workspace id.') }, ['workspaceId']) }),
  tool('issue_api_key',
    'Issue an API key (anon | service) for a workspace. MUTATING — requires the mcp:falcone:api-keys:write scope.',
    { method: 'POST', path: '/v1/workspaces/{workspaceId}/api-keys', family: 'api-keys', scope: 'mcp:falcone:api-keys:write',
      inputSchema: obj({ workspaceId: str('The workspace id.'), keyType: str('Key type: anon or service.'), scopes: { type: 'array', items: { type: 'string' }, description: 'Scopes to bind to a service key.' } }, ['workspaceId', 'keyType']) }),
  tool('revoke_api_key',
    'Revoke an API key by id. MUTATING — requires the mcp:falcone:api-keys:write scope.',
    { method: 'DELETE', path: '/v1/workspaces/{workspaceId}/api-keys/{keyId}', family: 'api-keys', scope: 'mcp:falcone:api-keys:write',
      inputSchema: obj({ workspaceId: str('The workspace id.'), keyId: str('The API-key id to revoke.') }, ['workspaceId', 'keyId']) }),

  // ── Embedding configuration (executor-served) ────────────────────────────────
  tool('set_embedding_provider',
    'Configure the embedding provider for a workspace (vector search). MUTATING — requires the mcp:falcone:embedding:write scope.',
    { method: 'PUT', path: '/v1/workspaces/{workspaceId}/embedding-provider', family: 'embedding', scope: 'mcp:falcone:embedding:write',
      inputSchema: obj({ workspaceId: str('The workspace id.'), provider: str('Embedding provider key.'), model: str('Embedding model name.') }, ['workspaceId', 'provider']) }),

  // ── Authoring (in-process, deterministic) ────────────────────────────────────
  {
    name: 'plan_project',
    description: 'Turn a declarative desired-state project spec into an ordered, validated plan of catalog tool calls (reason→define→deploy). Read-only and deterministic: it computes the plan but performs NO changes — execute the returned steps yourself by calling the referenced tools in order. Use this to scaffold a whole project (workspaces + databases + functions + topics + buckets) before acting.',
    inputSchema: obj({
      workspaces: {
        type: 'array',
        description: 'Desired workspaces and the resources each should contain.',
        items: obj({
          slug: str('Workspace slug.'),
          environment: str('Environment, e.g. dev/prod.'),
          database: obj({ engine: str('postgresql | mongodb.') }, ['engine']),
          functions: { type: 'array', items: obj({ name: str('Function name.'), runtime: str('Runtime.') }, ['name']), description: 'Functions to register.' },
          topics: { type: 'array', items: str('Topic name.'), description: 'Event topics to provision.' },
          buckets: { type: 'array', items: str('Bucket name.'), description: 'Storage buckets to provision.' },
        }, ['slug']),
      },
    }, ['workspaces']),
    mutates: false, scope: null, method: null, path: null, family: 'authoring', kind: 'authoring',
  },

  // ── Server configuration (superadmin-only) ───────────────────────────────────
  {
    name: 'get_mcp_config',
    description: 'Get the live first-party MCP server configuration: whether the server is enabled and which tools are disabled. Read-only.',
    inputSchema: obj(),
    mutates: false, scope: null, method: null, path: null, family: 'config', kind: 'config-get',
  },
  {
    name: 'set_mcp_config',
    description: 'Change the first-party MCP server configuration (enable/disable the server; disable/enable individual tools). MUTATING and SUPERADMIN-ONLY — requires a platform superadmin role; a disabled tool disappears from tools/list and cannot be called.',
    inputSchema: obj({
      enabled: { type: 'boolean', description: 'Enable or disable the whole first-party MCP server.' },
      disableTools: { type: 'array', items: { type: 'string' }, description: 'Tool names to disable.' },
      enableTools: { type: 'array', items: { type: 'string' }, description: 'Tool names to re-enable.' },
    }),
    mutates: true, scope: null, method: null, path: null, family: 'config', kind: 'config-set', superadminOnly: true,
  },
];

export function readTools() {
  return OFFICIAL_TOOLS.filter((t) => !t.mutates);
}

export function mutatingTools() {
  return OFFICIAL_TOOLS.filter((t) => t.mutates);
}

export function toolByName(name) {
  return OFFICIAL_TOOLS.find((t) => t.name === name) ?? null;
}

/**
 * The `tools/list` payload shape (name/description/inputSchema + a mutating hint), filtered to the
 * tools currently enabled by the server configuration.
 * @param {(name:string)=>boolean} [isEnabled]  predicate; defaults to all-enabled.
 */
export function toolsListForClient(isEnabled = () => true) {
  return OFFICIAL_TOOLS.filter((t) => isEnabled(t.name)).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: {
      readOnlyHint: !t.mutates,
      ...(t.scope ? { requiredScope: t.scope } : {}),
      ...(t.superadminOnly ? { superadminOnly: true } : {}),
    },
  }));
}
