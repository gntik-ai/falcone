// Drives the legacy console build (apps/web-console) in the same browser, with the same session,
// clock and mocked backend as the Next build, so the two pages can be compared request by request.
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { endpoints as shellEndpoints, responseFor as shellResponse, sessionFor } from '../fixtures/shell.ts';
import { createEndpointRegistry } from '../endpoint-registry.ts';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
let building;
// An existing build is reused (LEGACY_CONSOLE_DIST); otherwise the legacy bundle is built once per worker.
export function legacyDist() {
  building ??= (async () => {
    if (process.env.LEGACY_CONSOLE_DIST) return resolve(process.env.LEGACY_CONSOLE_DIST);
    const existing = join(root, 'apps/web-console/dist');
    if (existsSync(join(existing, 'index.html'))) return existing;
    const out = join(await mkdtemp(join(tmpdir(), 'legacy-console-')), 'dist');
    execFileSync('pnpm', ['--filter', '@in-falcone/web-console', 'exec', 'vite', 'build', '--outDir', out, '--emptyOutDir'], { cwd: root, stdio: 'pipe', timeout: 900_000 });
    return out;
  })();
  return building;
}

async function serve(dist) {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = resolve(dist, `.${path}`);
    if (!file.startsWith(resolve(dist) + sep) || !extname(file) || !existsSync(file) || !statSync(file).isFile()) file = join(dist, 'index.html');
    response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(response);
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, close: () => new Promise((done) => server.close(done)) };
}

// Opens `route` in the legacy build. `role` and `pageEndpoints` match the Next parity fixture.
export async function openLegacy({ browser, role, locale, viewport, pageEndpoints, route, variants = {} }) {
  const dist = await legacyDist();
  const server = await serve(dist);
  const context = await browser.newContext({ locale, viewport });
  const page = await context.newPage();
  const requests = [], faults = [];
  const registry = createEndpointRegistry(shellEndpoints, shellResponse, pageEndpoints);
  registry.setVariants(variants);
  await page.clock.setFixedTime(new Date('2026-06-01T12:00:00Z'));
  page.on('pageerror', (error) => faults.push(`pageerror: ${error.message}`));
  await page.addInitScript(({ session }) => {
    sessionStorage.setItem('in-falcone.console-shell-session', JSON.stringify(session));
    localStorage.removeItem('in-falcone.console-active-context');
  }, { session: sessionFor(role) });
  await page.route('**/v1/**', async (handled) => {
    const request = handled.request(), url = new URL(request.url());
    let body;
    try { body = request.postDataJSON() ?? undefined; } catch { body = request.postData(); }
    requests.push({ method: request.method(), path: url.pathname + url.search, body });
    const name = registry.find(request.method(), url.pathname, body);
    // Legacy-only reads (capabilities and similar) have no fixture; they answer like the gateway.
    if (!name) return handled.fulfill({ status: 404, json: { error_msg: '404 Route Not Found' } });
    const response = registry.responseFor(name, role, body);
    if (response.delayMs) await new Promise((done) => setTimeout(done, response.delayMs));
    if (response.network) return handled.abort('failed');
    return handled.fulfill({ status: response.status ?? 200, json: response.body });
  });
  await page.goto(`${server.origin}${route}`);
  return { page, requests, faults, setVariants: (value) => registry.setVariants(value), close: async () => { await context.close(); await server.close(); } };
}
