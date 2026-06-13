/**
 * Instant MCP — generate a DRAFT tool manifest from a tenant's resources
 * (change: add-mcp-instant-generator, #392; epic #386).
 *
 * Extensible per-resource generators turn a tenant's database schema, functions, storage and
 * events into MCP tools. The output is ALWAYS a draft that must pass curation (#393) — this module
 * cannot emit a published manifest (raw auto-dumps degrade LLM tool-call quality). Data tools map
 * to the platform's RLS-bound data path (executor, ADR-1/ADR-4); the tenant is never an argument.
 *
 * Tool shape: { name, description, inputSchema, mutates, suggestedScope, source, method, path }.
 */

const obj = (props = {}, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });

// Pragmatic SQL/column type → JSON-schema type map; unknown → string.
function jsonType(sqlType = '') {
  const t = String(sqlType).toLowerCase();
  if (/(int|serial|numeric|decimal|real|double|float)/.test(t)) return 'number';
  if (/bool/.test(t)) return 'boolean';
  if (/(json|jsonb)/.test(t)) return 'object';
  return 'string';
}

function writeScope(serverId, resource) {
  return `mcp:${serverId}:write:${resource}`;
}

/** PostgreSQL schema → read `query_<table>` + mutating `insert_<table>`. */
export function generateFromPostgresSchema(serverId, schema = {}) {
  const tools = [];
  const tables = [...(schema.tables ?? [])].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const db = schema.database ?? 'default';
  const schemaName = schema.name ?? 'public';
  for (const table of tables) {
    const cols = table.columns ?? [];
    const colProps = Object.fromEntries(cols.map((c) => [c.name, { type: jsonType(c.type), description: `Column ${c.name} (${c.type}).` }]));
    const basePath = `/v1/postgres/workspaces/{workspaceId}/data/${db}/schemas/${schemaName}/tables/${table.name}`;
    tools.push({
      name: `query_${table.name}`,
      description: `Query rows from the "${table.name}" table with optional filters and pagination. Read-only; runs under the tenant's row-level security so only this tenant's rows are returned.`,
      inputSchema: obj({ workspaceId: { type: 'string', description: 'Workspace id.' }, filter: { type: 'object', description: 'Optional column filters.' }, limit: { type: 'number' } }, ['workspaceId']),
      mutates: false, suggestedScope: null, source: { type: 'postgres', table: table.name }, method: 'GET', path: basePath,
    });
    tools.push({
      name: `insert_${table.name}`,
      description: `Insert a row into the "${table.name}" table. MUTATING — the inserted row is tenant-scoped by row-level security.`,
      inputSchema: obj({ workspaceId: { type: 'string', description: 'Workspace id.' }, row: obj(colProps) }, ['workspaceId', 'row']),
      mutates: true, suggestedScope: writeScope(serverId, `table:${table.name}`), source: { type: 'postgres', table: table.name }, method: 'POST', path: basePath,
    });
  }
  return tools;
}

/** Functions → `invoke_<fn>`. */
export function generateFromFunctions(serverId, functions = []) {
  return [...functions].sort((a, b) => String(a.name).localeCompare(String(b.name))).map((fn) => ({
    name: `invoke_${fn.name}`,
    description: `Invoke the "${fn.name}" serverless function${fn.description ? ` — ${fn.description}` : ''}. MUTATING (a function may have side effects).`,
    inputSchema: obj({ payload: { type: 'object', description: 'Invocation payload.' } }),
    mutates: true, suggestedScope: writeScope(serverId, `function:${fn.name}`), source: { type: 'function', id: fn.id ?? fn.name }, method: 'POST', path: `/v1/functions/${fn.id ?? fn.name}/invoke`,
  }));
}

/** Storage buckets → object get/put/delete. */
export function generateFromStorage(serverId, buckets = []) {
  const tools = [];
  for (const bucket of [...buckets].sort((a, b) => String(a.name ?? a).localeCompare(String(b.name ?? b)))) {
    const name = bucket.name ?? bucket;
    const keySchema = obj({ key: { type: 'string', description: 'Object key.' } }, ['key']);
    tools.push({ name: `get_object_${name}`, description: `Get an object from the "${name}" storage bucket. Read-only.`, inputSchema: keySchema, mutates: false, suggestedScope: null, source: { type: 'storage', bucket: name }, method: 'GET', path: `/v1/objects/${name}/{key}` });
    tools.push({ name: `put_object_${name}`, description: `Put (upload/overwrite) an object into the "${name}" bucket. MUTATING.`, inputSchema: obj({ key: { type: 'string' }, content: { type: 'string' } }, ['key', 'content']), mutates: true, suggestedScope: writeScope(serverId, `bucket:${name}`), source: { type: 'storage', bucket: name }, method: 'PUT', path: `/v1/objects/${name}/{key}` });
    tools.push({ name: `delete_object_${name}`, description: `Delete an object from the "${name}" bucket. MUTATING and destructive.`, inputSchema: keySchema, mutates: true, suggestedScope: writeScope(serverId, `bucket:${name}`), source: { type: 'storage', bucket: name }, method: 'DELETE', path: `/v1/objects/${name}/{key}` });
  }
  return tools;
}

/** Events → publish / subscribe. */
export function generateFromEvents(serverId, topics = []) {
  const topicEnum = [...topics].map((t) => t.name ?? t).sort();
  return [
    { name: 'publish_event', description: `Publish an event to a tenant topic${topicEnum.length ? ` (one of: ${topicEnum.join(', ')})` : ''}. MUTATING.`, inputSchema: obj({ topic: { type: 'string' }, payload: { type: 'object' } }, ['topic', 'payload']), mutates: true, suggestedScope: writeScope(serverId, 'events'), source: { type: 'events' }, method: 'POST', path: '/v1/events/publish' },
    { name: 'subscribe_events', description: 'Subscribe to a tenant topic and stream events (Server-Sent Events). Read-only.', inputSchema: obj({ topic: { type: 'string' } }, ['topic']), mutates: false, suggestedScope: null, source: { type: 'events' }, method: 'GET', path: '/v1/events/subscribe' },
  ];
}

/** Extensible registry, keyed by resource type. */
export const GENERATORS = {
  postgres: generateFromPostgresSchema,
  functions: generateFromFunctions,
  storage: generateFromStorage,
  events: generateFromEvents,
};

/**
 * Generate the DRAFT Instant-MCP manifest from a tenant's resources.
 * @param {string} serverId
 * @param {{postgres?:object, functions?:Array, storage?:Array, events?:Array}} resources
 * @returns {{ serverId:string, status:'draft', requiresCuration:true, generatedFrom:string[], tools:Array }}
 */
export function generateInstantManifest(serverId, resources = {}) {
  const tools = [];
  const generatedFrom = [];
  // Stable iteration order for determinism.
  for (const type of Object.keys(GENERATORS).sort()) {
    if (resources[type] === undefined) continue;
    const gen = GENERATORS[type];
    const produced = gen(serverId, resources[type]);
    if (produced.length > 0) generatedFrom.push(type);
    tools.push(...produced);
  }
  tools.sort((a, b) => a.name.localeCompare(b.name));
  // Hard invariant: Instant MCP output is ALWAYS a draft requiring curation (#393).
  return { serverId, status: 'draft', requiresCuration: true, generatedFrom, tools };
}
