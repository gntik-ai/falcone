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

import { flowToMcpTool } from './mcp-workflows-tools.mjs';

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
    // The executor's data-rows route is …/tables/{t}/rows (server.mjs `${data}/rows`). The base
    // (without /rows) matches NO executor route and would fall through to the executor index.
    const rowsPath = `/v1/postgres/workspaces/{workspaceId}/data/${db}/schemas/${schemaName}/tables/${table.name}/rows`;
    const src = { type: 'postgres', database: db, schema: schemaName, table: table.name };
    tools.push({
      name: `query_${table.name}`,
      description: `Query rows from the "${table.name}" table with optional filters and pagination. Read-only; runs under the tenant's row-level security so only this tenant's rows are returned.`,
      inputSchema: obj({ workspaceId: { type: 'string', description: 'Workspace id.' }, filter: { type: 'object', description: 'Optional column filters.' }, limit: { type: 'number' } }, ['workspaceId']),
      mutates: false, suggestedScope: null, source: src, method: 'GET', path: rowsPath,
    });
    tools.push({
      name: `insert_${table.name}`,
      description: `Insert a row into the "${table.name}" table. MUTATING — the inserted row is tenant-scoped by row-level security.`,
      inputSchema: obj({ workspaceId: { type: 'string', description: 'Workspace id.' }, row: obj(colProps) }, ['workspaceId', 'row']),
      mutates: true, suggestedScope: writeScope(serverId, `table:${table.name}`), source: src, method: 'POST', path: rowsPath,
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
    // The executor invokes by ACTION NAME under the workspace prefix (server.mjs
    // `${fn}/([^/]+)/invocations` where fn = .../actions). The old /v1/functions/<id>/invoke
    // path was removed and matches no route → executor index.
    mutates: true, suggestedScope: writeScope(serverId, `function:${fn.name}`), source: { type: 'function', name: fn.name }, method: 'POST', path: `/v1/functions/workspaces/{workspaceId}/actions/${fn.name}/invocations`,
  }));
}

/** Storage buckets → object get/put/delete. */
export function generateFromStorage(serverId, buckets = []) {
  const tools = [];
  for (const bucket of [...buckets].sort((a, b) => String(a.name ?? a).localeCompare(String(b.name ?? b)))) {
    const name = bucket.name ?? bucket;
    const id = bucket.id ?? bucket.bucketId ?? name;
    const keySchema = obj({ key: { type: 'string', description: 'Object key.' } }, ['key']);
    const src = { type: 'storage', bucket: name, bucketId: id };
    // The wired storage route is /v1/storage/buckets/{bucketId}/objects/{objectKey} (route catalog,
    // #500). The old /v1/objects/<bucket>/<key> path was removed → executor index. {objectKey} is
    // filled per-call from args.key; the bucketId is baked from the source.
    const objPath = `/v1/storage/buckets/${id}/objects/{objectKey}`;
    tools.push({ name: `get_object_${name}`, description: `Get an object from the "${name}" storage bucket. Read-only.`, inputSchema: keySchema, mutates: false, suggestedScope: null, source: src, method: 'GET', path: objPath });
    tools.push({ name: `put_object_${name}`, description: `Put (upload/overwrite) an object into the "${name}" bucket. MUTATING.`, inputSchema: obj({ key: { type: 'string' }, content: { type: 'string' } }, ['key', 'content']), mutates: true, suggestedScope: writeScope(serverId, `bucket:${name}`), source: src, method: 'PUT', path: objPath });
    tools.push({ name: `delete_object_${name}`, description: `Delete an object from the "${name}" bucket. MUTATING and destructive.`, inputSchema: keySchema, mutates: true, suggestedScope: writeScope(serverId, `bucket:${name}`), source: src, method: 'DELETE', path: objPath });
  }
  return tools;
}

/** Events → publish / consume. */
export function generateFromEvents(serverId, topics = []) {
  const topicEnum = [...topics].map((t) => t.name ?? t).sort();
  // The executor's event routes are workspace-scoped and carry the topic as a path segment
  // (server.mjs `${evt}/([^/]+)/publish` and `${evt}/([^/]+)/messages`). The old
  // /v1/events/publish | /v1/events/subscribe paths match no route → executor index. {topic} is
  // filled per-call from args.topic.
  return [
    { name: 'publish_event', description: `Publish an event to a tenant topic${topicEnum.length ? ` (one of: ${topicEnum.join(', ')})` : ''}. MUTATING.`, inputSchema: obj({ topic: { type: 'string' }, payload: { type: 'object' } }, ['topic', 'payload']), mutates: true, suggestedScope: writeScope(serverId, 'events'), source: { type: 'events' }, method: 'POST', path: '/v1/events/workspaces/{workspaceId}/topics/{topic}/publish' },
    { name: 'consume_events', description: 'Read the latest events from a tenant topic. Read-only.', inputSchema: obj({ topic: { type: 'string' } }, ['topic']), mutates: false, suggestedScope: null, source: { type: 'events' }, method: 'GET', path: '/v1/events/workspaces/{workspaceId}/topics/{topic}/messages' },
  ];
}

/**
 * Published flows → long-running `run_flow_<flow>` tools (change: add-mcp-workflow-and-platform-
 * binding, #566). Reuses the reviewed flow→MCP-Tasks mapping (mcp-workflows-tools.mjs) so invoking
 * the tool starts a durable workflow execution. The mapper emits `scope`; mirror it onto
 * `suggestedScope` so curation's publish gate (which defaults a mutating tool's scope from
 * suggestedScope) keeps the flow's run scope. The workspace/tenant are credential-derived.
 */
export function generateFromFlows(serverId, flows = []) {
  return [...flows]
    .sort((a, b) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id)))
    .map((flow) => {
      const tool = flowToMcpTool(flow);
      return { ...tool, suggestedScope: tool.suggestedScope ?? tool.scope ?? null };
    });
}

/** Extensible registry, keyed by resource type. */
export const GENERATORS = {
  postgres: generateFromPostgresSchema,
  functions: generateFromFunctions,
  storage: generateFromStorage,
  events: generateFromEvents,
  flows: generateFromFlows,
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
