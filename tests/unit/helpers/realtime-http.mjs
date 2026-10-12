import { Readable, Writable } from 'node:stream';
import { createControlPlaneServer } from '../../../apps/control-plane-executor/src/runtime/server.mjs';

// Exercise the real HTTP listener without binding a socket in restricted sandboxes.
export async function realtimeRequest(options, url, headers = {}) {
  const req = new Readable({ read() {} });
  Object.assign(req, { method: 'GET', url, headers });
  const chunks = [];
  let written;
  const firstWrite = new Promise(resolve => { written = resolve; });
  const res = new Writable({ write(chunk, encoding, done) { chunks.push(chunk); written(); done(); } });
  res.headers = {};
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; };
  res.writeHead = (status, headers) => {
    res.statusCode = status;
    res.headersSent = true;
    Object.assign(res.headers, headers);
  };
  const server = createControlPlaneServer({ registry: {}, logger: { error() {} }, ...options });
  server.emit('request', req, res);
  await firstWrite;
  await new Promise(resolve => setImmediate(resolve));
  return {
    res,
    get body() { return Buffer.concat(chunks).toString(); },
    close() { req.emit('close'); res.end(); },
  };
}
