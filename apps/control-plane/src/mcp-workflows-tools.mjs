/**
 * Temporal flows as MCP tools (change: add-mcp-workflows-as-tools, #395; epic #386).
 *
 * Pure mapping between a tenant's published Flow (durable Temporal workflow) and the MCP Tasks
 * extension: a published flow -> a long-running MCP tool; invoking it starts a flow execution and
 * returns an MCP Task handle keyed by the executionId (no synchronous hold); a flow execution's
 * status maps to an MCP Task status. Reuses the flows executions API + flow-monitoring SSE.
 * The tenant/workspace are credential-derived (ADR-2) — never taken from tool arguments.
 *
 * NOTE: the MCP Tasks extension is in the 2026-07-28 RC — these field names are provisional and
 * isolated here so they can be re-pinned when the spec finalizes (transport pinned to 2025-11-25).
 */

const obj = (props = {}, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });

function sanitize(v) {
  return String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Map a published flow to a long-running MCP tool.
 * @param {{id:string, name:string, description?:string, inputSchema?:object}} flow
 * @returns {object} an MCP tool descriptor (long-running)
 */
export function flowToMcpTool(flow = {}) {
  const slug = sanitize(flow.name ?? flow.id);
  return {
    name: `run_flow_${slug}`,
    description: `Run the "${flow.name ?? slug}" flow${flow.description ? ` — ${flow.description}` : ''}. Long-running: this starts a durable workflow and returns a Task you poll/stream to completion.`,
    inputSchema: flow.inputSchema ?? obj(),
    mutates: true,
    longRunning: true,
    scope: `mcp:flows:run:${slug}`,
    source: { type: 'flow', flowId: flow.id },
    method: 'POST',
    path: `/v1/flows/workspaces/{workspaceId}/flows/${flow.id}/executions`,
  };
}

/**
 * Build the control-plane call to START a flow execution from a tool invocation.
 * The workspaceId comes from the credential-derived context, NEVER from args; args become the
 * flow input. Returns the request descriptor; the executionId in the response is the Task id.
 * @param {object} flow
 * @param {object} args  tool arguments (the flow input)
 * @param {{workspaceId:string}} ctx  credential-derived context
 */
export function buildStartExecutionCall(flow = {}, args = {}, ctx = {}) {
  if (!ctx.workspaceId) throw new Error('workspaceId must come from the verified credential context');
  // Strip any tenant/workspace the caller tried to smuggle in args — they must not influence routing.
  const { tenantId: _t, workspaceId: _w, ...input } = args ?? {};
  return {
    method: 'POST',
    path: `/v1/flows/workspaces/${encodeURIComponent(ctx.workspaceId)}/flows/${encodeURIComponent(flow.id)}/executions`,
    body: { input },
  };
}

/** The MCP Task handle derived from a started execution. */
export function taskHandleFromExecution(execution = {}) {
  return { taskId: execution.executionId ?? execution.id, ...mapExecutionToTaskStatus(execution) };
}

const RUNNING = new Set(['running', 'started', 'queued', 'pending', 'continued']);
const DONE = new Set(['completed', 'succeeded', 'success']);
const FAILED = new Set(['failed', 'errored', 'error', 'timed_out']);
const CANCELLED = new Set(['cancelled', 'canceled', 'terminated']);

/**
 * Map a flow execution to an MCP Task status (Tasks extension, RC wording — provisional).
 * @param {{status?:string, result?:any, error?:any}} execution
 * @returns {{status:'working'|'completed'|'failed'|'cancelled', result?:any, error?:any}}
 */
export function mapExecutionToTaskStatus(execution = {}) {
  const s = String(execution.status ?? '').toLowerCase();
  if (DONE.has(s)) return { status: 'completed', result: execution.result ?? null };
  if (FAILED.has(s)) return { status: 'failed', error: execution.error ?? 'execution failed' };
  if (CANCELLED.has(s)) return { status: 'cancelled' };
  if (RUNNING.has(s)) return { status: 'working' };
  return { status: 'working' }; // unknown/in-flight -> still working (poll again)
}
