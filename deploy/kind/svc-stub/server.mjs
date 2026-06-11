// TEST/DEPLOY-ONLY generic service stub (health/info; 501 elsewhere).
// Used for chart components whose real runtime cannot run in this kind profile
// (e.g. openwhisk standalone requires the docker socket to spawn action
// containers). PORT/SERVICE_NAME via env.
import http from 'node:http';
const port = Number(process.env.PORT ?? 8080);
const name = process.env.SERVICE_NAME ?? 'falcone-svc-stub';
const started = new Date().toISOString();
http.createServer((req, res) => {
  if (req.url === '/healthz' || req.url === '/readyz' || req.url === '/ping') { res.writeHead(200, {'content-type':'text/plain'}); return res.end('ok'); }
  if (req.url === '/') { res.writeHead(200, {'content-type':'application/json'}); return res.end(JSON.stringify({ service: name, mode: 'stub', started })); }
  res.writeHead(501, {'content-type':'application/json'});
  res.end(JSON.stringify({ code:'NOT_IMPLEMENTED', service: name }));
}).listen(port, () => console.log(`${name} stub on :${port}`));
