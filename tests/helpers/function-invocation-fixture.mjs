import { generateKeyPairSync } from 'node:crypto';
import { EventEmitter } from 'node:events';

// Ephemeral test-only signing material; never persisted or printed.
export function invocationFixture(kid = 'test-active') {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid };
  return {
    privateKey, publicKey, jwk,
    env: {
      FN_INVOCATION_KEY_ID: kid,
      FN_INVOCATION_PRIVATE_KEY: privateKey.export({ format: 'pem', type: 'pkcs8' }),
      FN_INVOCATION_JWKS: JSON.stringify({ keys: [jwk] }),
    },
  };
}

export function installInvocationFixture(t, fixture) {
  const previous = Object.fromEntries(Object.keys(fixture.env).map((name) => [name, process.env[name]]));
  Object.assign(process.env, fixture.env);
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

// Exercise the real HTTP request listener with raw body chunks, without a network socket.
export function runtimeRequest(server, { method = 'POST', path = '/', headers = {}, body = '{}' } = {}) {
  return new Promise((resolve) => {
    const req = Object.assign(new EventEmitter(), { method, url: path, headers });
    const res = {
      writeHead(statusCode) { this.statusCode = statusCode; },
      end(value) { resolve({ statusCode: this.statusCode, body: JSON.parse(value) }); },
    };
    server.emit('request', req, res);
    for (const chunk of Array.isArray(body) ? body : [Buffer.from(body)]) req.emit('data', chunk);
    req.emit('end');
  });
}
