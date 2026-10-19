import { installSession } from '../browser-session.mjs';
import { test, expect } from '@playwright/test';
import { startServer, securityHeaders } from './server.mjs';

let server;
test.beforeAll(async () => { server = await startServer(); });
test.afterAll(async () => { await server?.close(); });

async function observe(page) {
  const consoleCspErrors = [], externalRequests = [], fonts = [], workers = [], workerErrors = [];
  page.on('pageerror', (error) => workerErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /content security policy|\bcsp\b/i.test(message.text())) consoleCspErrors.push(message.text());
    if (/could not create web worker|falling back to loading web worker/i.test(message.text())) workerErrors.push(message.text());
  });
  page.context().on('request', (request) => {
    if (!['blob:', 'data:'].includes(new URL(request.url()).protocol) && new URL(request.url()).origin !== server.origin) externalRequests.push(request.url());
  });
  page.context().on('response', (response) => {
    if (response.request().resourceType() === 'font') fonts.push({ url: response.url(), status: response.status() });
  });
  page.on('worker', (worker) => workers.push(worker.url()));
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => window.cspViolations.push({ directive: event.violatedDirective, blockedURI: event.blockedURI }));
  });
  return { consoleCspErrors, externalRequests, fonts, workers, workerErrors };
}

async function expectClean(page, observed) {
  expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  expect(observed.consoleCspErrors).toEqual([]);
  expect(observed.externalRequests).toEqual([]);
  expect(observed.workerErrors).toEqual([]);
}

async function expectFonts(page, observed, mono = false) {
  const loaded = await page.evaluate(async (includeMono) => {
    await document.fonts.load('400 16px "Geist Sans"');
    if (includeMono) await document.fonts.load('400 16px "Geist Mono"');
    await document.fonts.ready;
    return [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family.replace(/["']/g, ''));
  }, mono);
  expect(loaded).toContain('Geist Sans');
  await expect(page.locator('body')).toHaveCSS('font-family', /^"?Geist Sans/);
  if (mono) {
    expect(loaded).toContain('Geist Mono');
    await expect(page.getByTestId('mono')).toHaveCSS('font-family', /^"?Geist Mono/);
  }
  expect(observed.fonts.length).toBeGreaterThan(0);
  for (const response of observed.fonts) {
    expect(new URL(response.url).origin).toBe(server.origin);
    expect(response.status).toBe(200);
  }
}

test('every concrete appRoutes path renders under the unchanged CSP with local assets', async ({ page }) => {
  test.setTimeout(300_000);
  const unmatched = await installSession(page);
  const observed = await observe(page);
  await page.goto(server.url('tests/csp/index.html'));
  await expect(page.locator('[data-app-route]').first()).toBeVisible();
  const routes = await page.locator('[data-app-route]').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  expect(routes.length).toBeGreaterThan(0);
  for (const path of routes) {
    const response = await page.goto(server.origin + path);
    expect(response.headers()['content-security-policy']).toBe(securityHeaders['content-security-policy']);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Consola', exact: true })).toHaveJSProperty('tagName', 'svg');
    await expectFonts(page, observed);
    const favicon = await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute('href');
    const url = new URL(favicon, page.url());
    expect(url.origin).toBe(server.origin);
    const icon = await page.request.get(url.href);
    expect(icon.status()).toBe(200);
    expect(icon.headers()['content-type']).toContain('image/svg+xml');
    await expectClean(page, observed);
  }
  expect(unmatched).toEqual([]);
});

test('the test-only Monaco and xyflow page uses local workers, fonts and inline SVG', async ({ page }) => {
  const observed = await observe(page);
  const response = await page.goto(server.url('tests/csp/index.html'));
  expect(response.headers()['content-security-policy']).toBe(securityHeaders['content-security-policy']);
  await expect(page.getByTestId('yaml-status')).toHaveText('YAML worker ready');
  await expect(page.getByTestId('editor-status')).toHaveText('Editor worker ready');
  await expect(page.locator('.monaco-editor').first()).toBeVisible();
  await expect(page.locator('.react-flow__node').first()).toHaveText('Local canvas');
  await expect(page.getByRole('img', { name: 'Harness icon' })).toHaveJSProperty('tagName', 'svg');
  await expectFonts(page, observed, true);
  expect(observed.workers.length).toBeGreaterThanOrEqual(2);
  for (const url of observed.workers) expect(url.startsWith('blob:') || new URL(url).origin === server.origin).toBe(true);
  await expectClean(page, observed);
});

test('negative control: an inline script in a dist copy triggers CSP enforcement', async ({ page }) => {
  const negative = await startServer({ injectInlineScript: true });
  try {
    await observe(page);
    const response = await page.goto(negative.url(''));
    expect(response.headers()['content-security-policy']).toBe(securityHeaders['content-security-policy']);
    await expect.poll(() => page.evaluate(() => window.cspViolations)).toContainEqual(expect.objectContaining({ blockedURI: 'inline' }));
    expect(await page.evaluate(() => window.inlineControlExecuted)).toBeUndefined();
  } finally { await negative.close(); }
});
