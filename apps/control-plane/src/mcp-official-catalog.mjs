/**
 * Falcone official (first-party) MCP server — curated tool catalog
 * (change: add-mcp-official-server, #391; epic #386).
 *
 * A CURATED subset of the platform management surface (services/gateway-config/
 * public-route-catalog.json) exposed as MCP tools — NOT a 1:1 export of all 36
 * structural_admin routes. Read tools (GET) are safe and need only the base
 * `mcp:invoke` scope; mutating tools (POST/PUT/DELETE) each carry an explicit
 * per-tool scope and are refused without it (read-first, design.md).
 *
 * Each tool: { name, description (LLM-optimized), inputSchema, mutates, scope, method, path }.
 * Tenant/workspace are credential-derived (ADR-2) — never read from tool arguments.
 */

export const BASE_SCOPE = 'mcp:invoke';

/** @typedef {{name:string,description:string,inputSchema:object,mutates:boolean,scope:string|null,method:string,path:string}} McpTool */

const obj = (props = {}, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });

/** @type {McpTool[]} */
export const OFFICIAL_TOOLS = [
  // ── Read (safe by default) ────────────────────────────────────────────────
  {
    name: 'list_workspaces',
    description: 'List the workspaces in the current tenant, with their slug, environment and status. Read-only; use this to discover where data and resources live before acting.',
    inputSchema: obj(),
    mutates: false, scope: null, method: 'GET', path: '/v1/workspaces',
  },
  {
    name: 'list_workspace_members',
    description: 'List the members of a workspace and their roles. Read-only.',
    inputSchema: obj({ workspaceId: str('The workspace id.') }, ['workspaceId']),
    mutates: false, scope: null, method: 'GET', path: '/v1/workspaces/{id}/members',
  },
  {
    name: 'list_schemas',
    description: 'List the database schemas defined in the current tenant. Read-only; inspect the data model before querying or mutating.',
    inputSchema: obj(),
    mutates: false, scope: null, method: 'GET', path: '/v1/schemas',
  },
  {
    name: 'list_plans',
    description: 'List the commercial plans available to the tenant and their capability keys and quota defaults. Read-only.',
    inputSchema: obj(),
    mutates: false, scope: null, method: 'GET', path: '/v1/plans',
  },
  {
    name: 'get_quota_usage',
    description: 'Get the current per-tenant/workspace quota usage and limits. Read-only; check headroom before provisioning more resources.',
    inputSchema: obj({ workspaceId: str('Optional workspace id to scope the usage to.') }),
    mutates: false, scope: null, method: 'GET', path: '/v1/observability/quota-usage',
  },

  // ── Mutating (off unless the explicit scope is granted) ─────────────────────
  {
    name: 'create_workspace',
    description: 'Create a new workspace in the current tenant. MUTATING — requires the mcp:falcone:workspaces:write scope.',
    inputSchema: obj({ slug: str('URL-safe workspace slug.'), environment: str('Environment, e.g. dev/staging/prod.') }, ['slug']),
    mutates: true, scope: 'mcp:falcone:workspaces:write', method: 'POST', path: '/v1/workspaces',
  },
  {
    name: 'add_workspace_member',
    description: 'Add a member to a workspace with a role. MUTATING — requires the mcp:falcone:members:write scope.',
    inputSchema: obj({ workspaceId: str('The workspace id.'), subject: str('The user/subject to add.'), role: str('Role to grant.') }, ['workspaceId', 'subject', 'role']),
    mutates: true, scope: 'mcp:falcone:members:write', method: 'POST', path: '/v1/workspaces/{id}/members',
  },
  {
    name: 'create_schema',
    description: 'Create a new database schema. MUTATING — requires the mcp:falcone:schemas:write scope.',
    inputSchema: obj({ name: str('Schema name.') }, ['name']),
    mutates: true, scope: 'mcp:falcone:schemas:write', method: 'POST', path: '/v1/schemas',
  },
  {
    name: 'deploy_function',
    description: 'Deploy (create) a serverless function. MUTATING — requires the mcp:falcone:functions:write scope.',
    inputSchema: obj({ workspaceId: str('The workspace id.'), name: str('Function name.'), runtime: str('Runtime, e.g. nodejs.') }, ['workspaceId', 'name']),
    mutates: true, scope: 'mcp:falcone:functions:write', method: 'POST', path: '/v1/functions',
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

/** The `tools/list` payload shape (name/description/inputSchema + a mutating hint). */
export function toolsListForClient() {
  return OFFICIAL_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { readOnlyHint: !t.mutates, ...(t.scope ? { requiredScope: t.scope } : {}) },
  }));
}
