// Unit tests for flows-as-MCP-tools mapping (change add-mcp-workflows-as-tools, #395).
import test from 'node:test';
import assert from 'node:assert/strict';
import { flowToMcpTool, buildStartExecutionCall, taskHandleFromExecution, mapExecutionToTaskStatus } from './mcp-workflows-tools.mjs';

const flow = { id: 'flw_1', name: 'Nightly Report', description: 'aggregate + email', inputSchema: { type: 'object', properties: { date: { type: 'string' } }, required: ['date'], additionalProperties: false } };

test('flowToMcpTool: long-running tool with the flow input schema + scope + executions path', () => {
  const t = flowToMcpTool(flow);
  assert.equal(t.name, 'run_flow_nightly-report');
  assert.equal(t.longRunning, true);
  assert.equal(t.mutates, true);
  assert.equal(t.scope, 'mcp:flows:run:nightly-report');
  assert.deepEqual(t.inputSchema, flow.inputSchema);
  assert.equal(t.method, 'POST');
  assert.match(t.path, /\/v1\/flows\/workspaces\/\{workspaceId\}\/flows\/flw_1\/executions$/);
});

test('buildStartExecutionCall: workspace from ctx, args -> input, smuggled tenant/workspace ignored', () => {
  const call = buildStartExecutionCall(flow, { date: '2026-06-13', tenantId: 'EVIL', workspaceId: 'EVIL_WS' }, { workspaceId: 'ws_real' });
  assert.equal(call.method, 'POST');
  assert.equal(call.path, '/v1/flows/workspaces/ws_real/flows/flw_1/executions');
  assert.ok(!call.path.includes('EVIL'));
  assert.deepEqual(call.body, { input: { date: '2026-06-13' } }); // tenantId/workspaceId stripped from input
});

test('buildStartExecutionCall: refuses when workspace is not in the credential context', () => {
  assert.throws(() => buildStartExecutionCall(flow, {}, {}), /credential/);
});

test('mapExecutionToTaskStatus: each lifecycle state -> MCP Task status', () => {
  assert.deepEqual(mapExecutionToTaskStatus({ status: 'running' }), { status: 'working' });
  assert.deepEqual(mapExecutionToTaskStatus({ status: 'completed', result: { rows: 3 } }), { status: 'completed', result: { rows: 3 } });
  assert.deepEqual(mapExecutionToTaskStatus({ status: 'failed', error: 'boom' }), { status: 'failed', error: 'boom' });
  assert.deepEqual(mapExecutionToTaskStatus({ status: 'terminated' }), { status: 'cancelled' });
  assert.deepEqual(mapExecutionToTaskStatus({ status: 'weird' }), { status: 'working' }); // unknown -> keep polling
});

test('taskHandleFromExecution: Task handle keyed by executionId', () => {
  const h = taskHandleFromExecution({ executionId: 'exec_9', status: 'running' });
  assert.equal(h.taskId, 'exec_9');
  assert.equal(h.status, 'working');
});
