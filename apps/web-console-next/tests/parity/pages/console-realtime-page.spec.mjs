import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { ready, realtimePath, capabilitiesPath, allowedDifferences, realtimeFixtures } from './console-realtime-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { sessionFor } from '../fixtures/shell.ts';
const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-realtime-page.json`, import.meta.url), 'utf8'))]));
const build = JSON.parse(readFileSync(new URL('../../../dist/.vite/manifest.json', import.meta.url), 'utf8'));
const entry = Object.values(build).find((chunk) => chunk.isEntry && chunk.name === 'app').file;
// Keep the named workspace fixture consistent with the synthetic session's membership.
test.beforeEach(async ({ parity: p }) => {
  await p.page.route(`**/${entry}`, async (route) => {
    await p.page.evaluate(() => {
      const key = 'in-falcone.console-shell-session';
      const session = JSON.parse(sessionStorage.getItem(key));
      session.principal.workspaceIds = ['ws-1'];
      sessionStorage.setItem(key, JSON.stringify(session));
    });
    await route.fallback();
  });
  await p.page.route((url) => url.pathname === '/v1/workspaces', async (route) => route.fulfill({ json: {
    items: [{ workspaceId: 'ws-1', tenantId: 'synthetic-tenant', displayName: 'Synthetic workspace', slug: 'synthetic' }], page: { after: null },
  } }));
});
const calls = (p) => p.network.requests.filter((r) => r.path === realtimePath);
const surface = (p) => p.page.locator('.console-realtime');
async function open(p, variants = {}) {
  await p.open(manifest.route, variants);
  await expect(surface(p).getByRole('status', { name: bundles[p.locale].loading })).toHaveCount(0);
}
async function snapshot(p, info, name) {
  await check.assertLocale(p);
  const body = await p.page.screenshot({ fullPage: true, animations: 'disabled' });
  await info.attach(`${name}-${p.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}
async function holdCapability(p, body, action) {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const handler = async (route) => { await held; await route.fulfill({ json: body }); };
  await p.page.route(`**${capabilitiesPath}`, handler);
  try { await action(); } finally { release(); await p.page.unroute(`**${capabilitiesPath}`, handler); }
}
for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-realtime-page | ${locale} | ${width}`, () => {
    test.use({ locale, role: 'superadmin', viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    const copy = bundles[locale];
    test('data', async ({ parity: p }) => {
      await open(p);
      await expect(surface(p).locator('dt')).toHaveText(Object.values(copy.fields));
      await expect(surface(p).locator('dd').nth(3)).toHaveText('postgresql-changes, mongodb-changes');
      await expect(surface(p).locator('pre')).toHaveCount(3);
      await expect(surface(p).locator('pre').first()).toContainText(ready.realtimeEndpointUrl);
      for (const fixture of ['workspace-realtime-dup-unsupported', 'workspace-realtime-null-endpoint', 'workspace-realtime-only-unsupported']) {
        await open(p, { realtime: fixture });
        if (fixture === 'workspace-realtime-null-endpoint') {
          await expect(surface(p).getByRole('button', { name: copy.copyEndpoint })).toHaveCount(0);
          await expect(surface(p).locator('pre').first()).toContainText('<REALTIME_ENDPOINT>');
          await expect(surface(p).getByText(copy.missingEndpoint, { exact: true })).toHaveCount(3);
        } else if (fixture === 'workspace-realtime-only-unsupported') await expect(surface(p).getByRole('heading', { name: copy.emptyTitle })).toBeVisible();
        else await expect(surface(p).locator('dd').nth(3)).toHaveText('postgresql-changes, mongodb-changes');
      }
      expect(allowedDifferences).toEqual(['inert disabled content', 'description list', 'endpoint copy', '403/404 states', 'back links', 'request id', 'focus moves']);
    });
    test('action', async ({ parity: p }) => {
      await open(p);
      expect(calls(p)).toEqual([{ method: 'GET', path: realtimePath, body: undefined }]);
      await p.page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value) => { window.__syntheticCopied = value; } } }));
      await surface(p).getByRole('button', { name: copy.copyEndpoint }).click();
      expect(await p.page.evaluate(() => window.__syntheticCopied)).toBe(ready.realtimeEndpointUrl);
      await surface(p).getByRole('tab', { name: 'Python' }).click();
      await surface(p).getByRole('button', { name: copy.copy, exact: true }).first().click();
      await expect(surface(p).getByText(copy.copiedSnippet, { exact: true })).toBeVisible();
      expect(await p.page.evaluate(() => sessionStorage.getItem('realtime-snippet-lang'))).toBe('python');
      await p.page.reload();
      await expect(surface(p).getByRole('tab', { name: 'Python' })).toHaveAttribute('aria-selected', 'true');
      await p.page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
      await surface(p).getByRole('button', { name: copy.copy, exact: true }).first().click();
      await expect(surface(p).getByText(copy.manual, { exact: true })).toBeVisible();
      await open(p, { realtime: 'workspace-realtime-500-then-ok' });
      const start = calls(p).length;
      await surface(p).getByRole('button', { name: copy.retry }).click();
      await expect(surface(p).getByRole('heading', { level: 1 })).toBeFocused();
      expect(calls(p)).toHaveLength(start + 1);
    });
    test('error-empty', async ({ parity: p, server }) => {
      for (const [fixture, key] of [['workspace-realtime-disabled', 'emptyTitle'], ['workspace-realtime-no-sources', 'emptyTitle'], ['workspace-realtime-403', 'noAccess'], ['workspace-realtime-404', 'notFound'], ['workspace-realtime-500', 'errorTitle'], ['workspace-realtime-network', 'errorTitle']]) {
        await open(p, { realtime: fixture });
        await expect(surface(p).getByRole('heading', { name: copy[key], exact: true })).toBeVisible();
      }
      for (const capability of ['capability-disabled', 'capability-error', 'capability-delayed-disabled']) {
        await open(p, { capabilities: capability });
        await expect(p.page.getByTestId('realtime-restricted')).toHaveAttribute('inert', '');
        await expect(surface(p).getByText(copy.upgrade, { exact: true })).toBeVisible();
      }
      await holdCapability(p, { capabilities: { realtime: true } }, async () => {
        p.network.setVariants({}); await p.page.goto(server.url('console/workspaces/ws-1/realtime'));
        await expect(surface(p).getByRole('status', { name: copy.loading })).toHaveAttribute('aria-busy', 'true');
        await expect(surface(p).getByRole('tablist')).toHaveCount(0);
      });
      await expect(surface(p).getByRole('tablist')).toBeVisible();
    });
    test('accessibility', async ({ parity: p }) => {
      for (const variants of [{}, { capabilities: 'capability-disabled' }, { realtime: 'workspace-realtime-500' }]) {
        await open(p, variants); await check.assertAccessibility(p); await check.assertLocale(p);
      }
      await open(p);
      await surface(p).getByRole('tab', { name: 'JavaScript' }).focus();
      await p.page.keyboard.press('ArrowRight'); await p.page.keyboard.press('Enter');
      await expect(surface(p).getByRole('tab', { name: 'Node.js' })).toHaveAttribute('aria-selected', 'true');
      await open(p, { realtime: 'workspace-realtime-500' });
      await surface(p).getByRole('button', { name: copy.retry }).click();
      await expect(surface(p).getByRole('button', { name: copy.retry })).toBeFocused();
    });
    test('runtime-health', async ({ parity: p, server }) => {
      await open(p); await check.assertRuntimeHealth(p);
      await open(p, { realtime: 'workspace-realtime-no-sources' });
      await surface(p).getByRole('link', { name: copy.provisioning }).click();
      await expect(p.page).toHaveURL(/\/next\/console\/workspaces\/ws-1\/provisioning$/);
      await expect(p.page.locator('main h1')).toBeVisible();
      await p.page.goBack(); await expect(surface(p).getByRole('heading', { level: 1 })).toBeVisible();
      await check.assertRuntimeHealth(p);
      // Back links retain the legacy document boundary until the workspace list migrates.
      for (const fixture of ['workspace-realtime-403', 'workspace-realtime-404']) {
        await open(p, { realtime: fixture });
        await p.page.route((url) => url.pathname === '/console/workspaces', (route) => route.fulfill({ contentType: 'text/html', body: `<html lang="${locale}"><body><main><h1>${copy.back}</h1></main></body></html>` }));
        const session = await p.page.evaluate(() => sessionStorage.getItem('in-falcone.console-shell-session'));
        await surface(p).getByRole('link', { name: copy.back }).click();
        await expect(p.page).toHaveURL(new URL('/console/workspaces', server.origin).href);
        expect(await p.page.evaluate(() => sessionStorage.getItem('in-falcone.console-shell-session'))).toBe(session);
        await check.assertRuntimeHealth(p);
      }
    });
    test('responsive', async ({ parity: p }) => {
      await open(p); await check.assertResponsive(p, width);
      await p.page.route(`**${realtimePath}`, (route) => route.fulfill({ json: { ...ready, realtimeEndpointUrl: `wss://${'synthetic-endpoint-'.repeat(50)}.example.test` } }));
      await p.page.reload(); await expect(surface(p).getByRole('tablist')).toBeVisible(); await check.assertResponsive(p, width);
    });
    test('visual-review', async ({ parity: p, server }, info) => {
      for (const fixture of ['workspace-realtime', 'workspace-realtime-null-endpoint', 'workspace-realtime-disabled', 'workspace-realtime-403', 'workspace-realtime-404', 'workspace-realtime-500']) {
        await open(p, { realtime: fixture }); await snapshot(p, info, fixture);
        if (fixture === 'workspace-realtime') for (const language of ['JavaScript', 'Node.js', 'Python']) {
          await surface(p).getByRole('tab', { name: language }).click(); await snapshot(p, info, `${fixture}-${language}`);
        }
      }
      await open(p, { capabilities: 'capability-disabled' }); await snapshot(p, info, 'capability-disabled');
      await holdCapability(p, { capabilities: { realtime: true } }, async () => {
        p.network.setVariants({ capabilities: 'capability-delayed' }); await p.page.goto(server.url('console/workspaces/ws-1/realtime'));
        await expect(surface(p).getByRole('status', { name: copy.loading })).toBeVisible(); await snapshot(p, info, 'capability-delayed');
      });
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
  });
}

for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) for (const variant of ['workspace-realtime-401-refresh-ok', 'workspace-realtime-401-refresh-rejected', 'workspace-realtime-401']) {
  test.describe(`realtime session | ${locale} | ${width} | ${variant}`, () => {
    test.use({ locale, role: 'superadmin', viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test('shared session refresh and replay are bounded', async ({ parity: p, server }) => {
      if (variant !== 'workspace-realtime-401-refresh-rejected') {
        await p.page.route('**/v1/auth/login-sessions/synthetic-session/refresh', async (route) => {
          if (route.request().method() !== 'POST') return route.fallback();
          const session = sessionFor('superadmin', true);
          session.principal.workspaceIds = ['ws-1'];
          p.network.requests.push({ method: 'POST', path: '/v1/auth/login-sessions/synthetic-session/refresh', body: route.request().postDataJSON() });
          await route.fulfill({ json: session });
        });
      }
      p.network.setVariants({ realtime: variant, refresh: variant === 'workspace-realtime-401-refresh-rejected' ? '401' : 'success' });
      await p.page.goto(server.url('console/workspaces/ws-1/realtime'));
      if (variant === 'workspace-realtime-401-refresh-ok') await expect(surface(p).locator('dl')).toBeVisible();
      else {
        await expect(p.page).toHaveURL(/\/login$/);
        expect(await p.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(new URL(server.url('console/workspaces/ws-1/realtime')).pathname);
      }
      expect(calls(p)).toHaveLength(variant === 'workspace-realtime-401-refresh-rejected' ? 1 : 2);
      expect(p.network.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/refresh'))).toHaveLength(1);
      await check.assertRuntimeHealth(p);
    });
  });
}
