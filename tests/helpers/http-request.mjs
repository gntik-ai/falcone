import { Duplex } from 'node:stream';

// Exercise Node's real HTTP parser without binding a sandbox-restricted socket.
export async function request(server, { method = 'POST', path, body = '{}', headers = {} }) {
  const chunks = [];
  const socket = new Duplex({ read() {}, write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  const finished = new Promise((resolve, reject) => { socket.once('finish', resolve); socket.once('error', reject); });
  const lines = Object.entries({ 'content-type': 'application/json', ...headers })
    .map(([name, value]) => `${name}: ${value}\r\n`).join('');
  server.emit('connection', socket);
  socket.push(`${method} ${path} HTTP/1.1\r\nHost: fixture.test\r\n${lines}Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
  try {
    await finished;
    const raw = Buffer.concat(chunks).toString();
    const separator = raw.indexOf('\r\n\r\n');
    const head = raw.slice(0, separator).split('\r\n');
    const responseHeaders = Object.fromEntries(head.slice(1).map(line => {
      const colon = line.indexOf(':');
      return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
    }));
    const payload = raw.slice(separator + 4);
    return { status: Number(head[0].split(' ')[1]), headers: responseHeaders, body: payload ? JSON.parse(payload) : null };
  } finally { socket.destroy(); }
}
