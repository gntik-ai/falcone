// EPHEMERAL SPIKE — minimal MCP-shaped server for the runtime/scale-to-zero spike.
// NOT production code. Hand-rolled JSON-RPC 2.0 over Streamable HTTP (no SDK) — just enough
// to prove a Knative ksvc can host an MCP-shaped server and scale to zero.
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 8080);
const TENANT_ID = process.env.TENANT_ID || 'unknown';
const PROTOCOL_VERSION = '2025-11-25';

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo back the provided message. Read-only.',
    inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
  },
  {
    name: 'tenant_info',
    description: "Return the tenant this MCP server is scoped to (proves per-tenant context).",
    inputSchema: { type: 'object', properties: {} },
  },
];

function rpc(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcErr(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      return rpc(id, {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: { name: 'mcp-spike-fixture', version: '0.0.0', tenant: TENANT_ID },
        capabilities: { tools: {} },
      });
    case 'tools/list':
      return rpc(id, { tools: TOOLS });
    case 'tools/call': {
      const name = params?.name;
      const args = params?.arguments || {};
      if (name === 'echo') return rpc(id, { content: [{ type: 'text', text: String(args.message ?? '') }] });
      if (name === 'tenant_info') return rpc(id, { content: [{ type: 'text', text: `tenant=${TENANT_ID}` }] });
      return rpcErr(id, -32602, `unknown tool: ${name}`);
    }
    case 'ping':
      return rpc(id, {});
    default:
      return rpcErr(id, -32601, `method not found: ${method}`);
  }
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405).end();
    return;
  }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let out;
    try {
      const msg = JSON.parse(body || '{}');
      out = handle(msg);
    } catch {
      out = rpcErr(null, -32700, 'parse error');
    }
    // log every tool call for the observability-evidence story
    console.log(JSON.stringify({ ts: new Date().toISOString(), tenant: TENANT_ID, method: out?.result ? 'ok' : 'err' }));
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
  });
});

server.listen(PORT, () => console.log(`mcp-spike-fixture listening on ${PORT} tenant=${TENANT_ID}`));
