import { Duplex } from 'node:stream';

// Exercise Node's HTTP parser, IncomingMessage and ServerResponse without a listening socket.
// The real server owns routing, authentication, body parsing and response serialization.
export async function request(server, method, path, { body, headers = {} } = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const wireHeaders = { host: 'localhost', connection: 'close', ...headers,
    ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }) };
  const wire = `${method} ${path} HTTP/1.1\r\n${Object.entries(wireHeaders).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n${payload}`;
  const chunks = [];
  let sent = false;
  const socket = new Duplex({
    read() { if (!sent) { sent = true; this.push(wire); } },
    write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); },
  });
  let observeResponse;
  const finished = new Promise((resolve, reject) => {
    socket.on('error', reject);
    socket.on('finish', resolve);
    observeResponse = (_req, res) => res.once('finish', resolve);
    server.once('request', observeResponse);
  });
  try {
    server.emit('connection', socket);
    await finished;
    const raw = Buffer.concat(chunks).toString();
    const split = raw.indexOf('\r\n\r\n');
    const lines = raw.slice(0, split).split('\r\n');
    const status = Number(lines.shift().split(' ')[1]);
    const responseHeaders = Object.fromEntries(lines.map(line => {
      const colon = line.indexOf(':');
      return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
    }));
    let text = raw.slice(split + 4);
    if (responseHeaders['transfer-encoding'] === 'chunked') {
      let decoded = '';
      while (text) {
        const end = text.indexOf('\r\n');
        const size = Number.parseInt(text.slice(0, end), 16);
        if (size === 0) break;
        decoded += text.slice(end + 2, end + 2 + size);
        text = text.slice(end + 2 + size + 2);
      }
      text = decoded;
    }
    return { status, headers: responseHeaders, text,
      body: responseHeaders['content-type']?.includes('application/json') ? JSON.parse(text) : undefined };
  } finally {
    server.removeListener('request', observeResponse);
    socket.destroy();
  }
}
