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
import { createInvocationVerifier } from './invocation-auth.mjs';

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

// Public keys and target identity are fixed for the revision before any FN_SRC evaluation.
export function createRuntimeServer(env = process.env) {
  const verifyInvocation = createInvocationVerifier(env);
  return http.createServer((req, res) => {
    // GET = readiness/health (Knative probes the container).
    if (req.method !== 'POST') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ready', runtime: 'nodejs', node: process.version }));
    }
    // Missing credentials are rejected even before reading the body.
    const authorization = req.headers.authorization;
    const unauthorized = () => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized invocation' }));
    };
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return unauthorized();
    const credential = authorization.slice(7);
    const redact = (value) => String(value).split(credential).join('[REDACTED]');
    const chunks = [];
    let bodyLength = 0;
    req.on('data', (c) => {
      bodyLength += c.length;
      if (bodyLength > 5e6) return req.destroy();
      chunks.push(c);
    });
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const context = verifyInvocation(authorization, body);
      if (!context) return unauthorized();
      let params = {};
      if (body) { try { params = JSON.parse(body); } catch { params = {}; } }
      const logs = [];
      const cc = {
        log: (...a) => logs.push(a.map(redact).join(' ')),
        info: (...a) => logs.push(a.map(redact).join(' ')),
        warn: (...a) => logs.push(a.map(redact).join(' ')),
        error: (...a) => logs.push(a.map(redact).join(' '))
      };
      try {
        const main = resolveMain(cc);
        if (typeof main !== 'function') throw new Error('the action must define a main(params) function');
        // #639: only the verified claims provide caller context; headers and params cannot forge it.
        const result = await Promise.resolve(main(params, context));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(redact(JSON.stringify({ status: 'success', result: result === undefined ? {} : result, logs })));
      } catch (e) {
        // Never log a raw tenant-controlled error: it may contain invocation credentials.
        const message = redact(e instanceof Error ? e.message : String(e));
        console.error('[fn-runtime] action threw:', message);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'failure', result: { error: message }, logs }));
      }
    });
  });
}
const server = createRuntimeServer();
// Bind only when run as the container entrypoint (CMD ["node","server.mjs"]); a
// test that imports this module gets `server` + the helpers without binding a port.
export { server };
const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) server.listen(PORT, () => console.log(`fn-runtime listening on :${PORT}`));
