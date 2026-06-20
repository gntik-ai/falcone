// Falcone function runtime — the container image each function's Knative Service
// runs. It loads the function source from FN_SRC (set per ksvc revision) and, on
// POST, executes main(params) and returns { status, result, logs }. Knative scales
// this from zero per function; the control-plane invokes it over the ksvc URL.
//
// nodejs convention (OpenWhisk-compatible): the source defines a `main(params)`
// function (global, module.exports.main, or exports.main) returning a value/Promise.
import http from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.PORT || 8080);
const require = createRequire(import.meta.url);

function resolveMain(captureConsole) {
  // Read FN_SRC at call time (the per-ksvc-revision source is fixed in prod; reading
  // per-invocation avoids stale module-load capture and is testable).
  const src = process.env.FN_SRC || '';
  const mod = { exports: {} };
  const compiled = new Function('module', 'exports', 'require', 'console',
    src + '\n;return (typeof main !== "undefined") ? main : (module.exports && module.exports.main);');
  return compiled(mod, mod.exports, require, captureConsole);
}

// Build the read-only caller context (#639) from the trusted X-Falcone-* request
// headers the control-plane executor injects from the VERIFIED JWT identity. Read
// ONLY from headers (never the user-controlled body) and surfaced to user code as
// the second argument of main(params, context), so a function can scope behaviour
// to its caller and the body cannot forge it. Exported for unit testing.
export function callerContextFromHeaders(headers = {}) {
  const h = (k) => { const v = headers[k]; return (typeof v === 'string' && v.length) ? v : null; };
  const roles = h('x-falcone-roles');
  return {
    tenantId: h('x-falcone-tenant-id'),
    workspaceId: h('x-falcone-workspace-id'),
    principal: h('x-falcone-principal'),
    actorType: h('x-falcone-actor-type'),
    roles: roles ? roles.split(',').map((r) => r.trim()).filter(Boolean) : [],
  };
}

const server = http.createServer((req, res) => {
  // GET = readiness/health (Knative probes the container).
  if (req.method !== 'POST') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ready', runtime: 'nodejs', node: process.version }));
  }
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 5e6) req.destroy(); });
  req.on('end', async () => {
    let params = {};
    if (body) { try { params = JSON.parse(body); } catch { params = {}; } }
    const logs = [];
    const cc = {
      log: (...a) => logs.push(a.map(String).join(' ')),
      info: (...a) => logs.push(a.map(String).join(' ')),
      warn: (...a) => logs.push(a.map(String).join(' ')),
      error: (...a) => logs.push(a.map(String).join(' '))
    };
    try {
      const main = resolveMain(cc);
      if (typeof main !== 'function') throw new Error('the action must define a main(params) function');
      // #639: deliver the verified caller context as a second argument. Built from
      // the trusted request headers, NOT from `params` (the user-controlled body).
      const context = callerContextFromHeaders(req.headers);
      const result = await Promise.resolve(main(params, context));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', result: result === undefined ? {} : result, logs }));
    } catch (e) {
      // Full stack to pod stdout (operators); return only the message to the caller
      // — never the stack trace (stack-trace exposure).
      console.error('[fn-runtime] action threw:', e);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'failure', result: { error: e instanceof Error ? e.message : String(e) }, logs }));
    }
  });
});
// Bind only when run as the container entrypoint (CMD ["node","server.mjs"]); a
// test that imports this module gets `server` + the helpers without binding a port.
export { server };
const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) server.listen(PORT, () => console.log(`fn-runtime listening on :${PORT}`));
