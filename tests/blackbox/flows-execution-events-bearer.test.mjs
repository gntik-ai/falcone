import test from 'node:test';
import assert from 'node:assert/strict';
import { Duplex } from 'node:stream';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import { createFlowMonitoringExecutor } from '../../apps/control-plane-executor/src/runtime/flow-monitoring-executor.mjs';
import { buildWorkflowId } from '../../apps/control-plane-executor/src/runtime/flow-executor.mjs';

const tenantId = 'synthetic-tenant';
const workspaceId = 'synthetic-workspace';
const executionId = buildWorkflowId(tenantId, workspaceId, 'synthetic-flow', 'synthetic-run');
const path = `/v1/flows/workspaces/${workspaceId}/executions/${encodeURIComponent(executionId)}/events`;

async function withServer(run) {
  const calls = [];
  const registry = createConnectionRegistry({ resolveConnection: () => ({ dsn: 'postgres://unused/none' }) });
  const flowMonitoringExecutor = createFlowMonitoringExecutor({ workflowHistoryProvider: {
    async describe(id) { calls.push(['describe', id]); return { status: { name: 'Completed' } }; },
    async fetchHistory(id) {
      calls.push(['fetchHistory', id]);
      return { events: [
        { eventId: 1, activityTaskScheduledEventAttributes: { activityId: 'synthetic-node' } },
        { eventId: 2, activityTaskCompletedEventAttributes: { scheduledEventId: 1 } },
      ] };
    },
    isTerminal: (status) => status === 'Completed',
  } });
  const identities = {
    'synthetic-owner': { tenantId, workspaceId },
    'synthetic-other-tenant': { tenantId: 'synthetic-other-tenant', workspaceId },
    'synthetic-other-workspace': { tenantId, workspaceId: 'synthetic-other-workspace' },
  };
  const server = createControlPlaneServer({
    registry, flowMonitoringExecutor, gatewaySharedSecret: 'synthetic-gateway-secret',
    jwtVerifier: { async verify(token) {
      const identity = identities[token];
      if (!identity) throw new Error('Synthetic invalid bearer');
      return { ...identity, credentialWorkspaceId: identity.workspaceId, actorId: 'synthetic-reader', roles: ['tenant_viewer'] };
    } },
    logger: { error() {} },
  });
  try { await run(server, calls); }
  finally {
    await registry.end();
    await flowMonitoringExecutor.close?.();
  }
}

// Substitute only the socket transport: Node's HTTP parser and the real request handler
// consume the bearer-only request, with no loopback listener or external infrastructure.
async function request(server, token) {
  const chunks = [];
  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, done) {
      chunks.push(Buffer.from(chunk));
      done();
      if (Buffer.concat(chunks).toString().includes('event: stream-end')) queueMicrotask(() => socket.destroy());
    },
  });
  const finished = new Promise((resolve, reject) => {
    socket.once('finish', resolve);
    socket.once('close', resolve);
    socket.once('error', reject);
  });
  server.emit('connection', socket);
  socket.push(`GET ${path} HTTP/1.1\r\nHost: synthetic-executor.test\r\nAuthorization: Bearer ${token}\r\nAccept: text/event-stream\r\nConnection: close\r\n\r\n`);
  try {
    await finished;
    const raw = Buffer.concat(chunks).toString();
    return { status: Number(raw.split(' ')[1]), raw };
  } finally { socket.destroy(); }
}

test('a verified bearer alone streams the owning execution history', async () => {
  await withServer(async (server, calls) => {
    const response = await request(server, 'synthetic-owner');
    assert.equal(response.status, 200);
    assert.match(response.raw, /content-type: text\/event-stream/i);
    const raw = response.raw;
    const frames = raw.split(/\r?\n/).filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)));
    assert.deepEqual(frames.map(({ type, nodeId, status }) => ({ type, nodeId, status })), [
      { type: 'node-status', nodeId: 'synthetic-node', status: 'scheduled' },
      { type: 'node-status', nodeId: 'synthetic-node', status: 'completed' },
      { type: 'stream-end', nodeId: undefined, status: 'Completed' },
    ]);
    assert.deepEqual(calls, [['describe', executionId], ['fetchHistory', executionId]]);
  });
});

for (const token of ['synthetic-other-tenant', 'synthetic-other-workspace', 'synthetic-invalid']) {
  test(`${token} is denied before the history follower is called`, async () => {
    await withServer(async (server, calls) => {
      const response = await request(server, token);
      assert.ok(response.status >= 400, 'foreign or invalid identity must not open a successful stream');
      const body = response.raw;
      assert.doesNotMatch(body, /event:|data:/);
      assert.deepEqual(calls, []);
    });
  });
}
