// Parse the legacy runtime's constants: no duplicated CSP or security headers.
import { readFile, writeFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = await readFile(new URL('../../../web-console/static-server.mjs', import.meta.url), 'utf8');
const policy = source.match(/const CONTENT_SECURITY_POLICY = (\[[\s\S]*?\])\.join\('; '\);/);
if (!policy) throw new Error('Cannot parse legacy CONTENT_SECURITY_POLICY');
const declarations = source.match(/const SECURITY_HEADERS = \{([\s\S]*?)\n\};/);
if (!declarations) throw new Error('Cannot parse legacy SECURITY_HEADERS');
export const securityHeaders = Object.fromEntries(declarations[1].trim().split('\n').map((line) => {
  const match = line.match(/^\s*'([^']+)': (CONTENT_SECURITY_POLICY|'([^']*)'),?$/);
  if (!match) throw new Error(`Cannot parse legacy security header: ${line}`);
  return [match[1], match[2] === 'CONTENT_SECURITY_POLICY' ? JSON.parse(policy[1]).join('; ') : match[3]];
}));

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json' };
export async function startServer({ injectInlineScript = false } = {}) {
  let root = fileURLToPath(new URL('../../dist/', import.meta.url));
  let temporary;
  // Always require the build, including when the requested URL would use fallback.
  await readFile(join(root, 'index.html'));
  if (injectInlineScript) {
    temporary = await mkdtemp(join(tmpdir(), 'next-csp-'));
    await cp(root, temporary, { recursive: true });
    root = temporary;
    const entry = join(root, 'index.html');
    const html = await readFile(entry, 'utf8');
    await writeFile(entry, html.replace('</head>', '<script>window.inlineControlExecuted = true</script></head>'));
  }
  const base = process.env.VITE_BASE_PATH || '/';
  if (!base.startsWith('/') || !base.endsWith('/')) throw new Error('VITE_BASE_PATH must start and end with /');
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (!path.startsWith(base)) { response.writeHead(404, securityHeaders); response.end(); return; }
      let file = resolve(root, path.slice(base.length) || 'index.html');
      if (!file.startsWith(resolve(root) + sep)) { response.writeHead(403, securityHeaders); response.end(); return; }
      if (!extname(file)) file = join(root, 'index.html');
      const body = await readFile(file);
      response.writeHead(200, { ...securityHeaders, 'content-type': mime[extname(file)] || 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404, securityHeaders);
      response.end();
    }
  });
  try {
    await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  } catch (error) {
    if (temporary) await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    url: (path) => origin + base + path,
    async close() {
      await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
      if (temporary) await rm(temporary, { recursive: true, force: true });
    },
  };
}
