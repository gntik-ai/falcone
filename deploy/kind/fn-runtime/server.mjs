// Falcone function runtime — the container image each function's Knative Service
// runs. It loads the function source from FN_SRC (set per ksvc revision) and, on
// POST, executes main(params) and returns { status, result, logs }. Knative scales
// this from zero per function; the control-plane invokes it over the ksvc URL.
//
// nodejs convention (OpenWhisk-compatible): the source defines a `main(params)`
// function (global, module.exports.main, or exports.main) returning a value/Promise.
import http from 'node:http';
import { createRequire } from 'node:module';

const SRC = process.env.FN_SRC || '';
const PORT = Number(process.env.PORT || 8080);
const require = createRequire(import.meta.url);

function resolveMain(captureConsole) {
  const mod = { exports: {} };
  const compiled = new Function('module', 'exports', 'require', 'console',
    SRC + '\n;return (typeof main !== "undefined") ? main : (module.exports && module.exports.main);');
  return compiled(mod, mod.exports, require, captureConsole);
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
      const result = await Promise.resolve(main(params));
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
server.listen(PORT, () => console.log(`fn-runtime listening on :${PORT}`));
