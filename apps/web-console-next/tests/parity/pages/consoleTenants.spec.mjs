import { createHash } from 'node:crypto';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';
import manifest, { tenantBody, tenantRows } from './consoleTenants.manifest.ts';
import es from '../../../src/locales/es/pages.console-tenants-page.json' with { type: 'json' };
import en from '../../../src/locales/en/pages.console-tenants-page.json' with { type: 'json' };

const copy = (p) => p.locale === 'es' ? es : en;
const button = (p, key) => p.page.getByRole('button', { name: copy(p)[key], exact: true });
const calls = (p, path) => p.network.requests.filter((request) => request.path === path);
const writes = (p) => calls(p, '/v1/tenants').filter((request) => request.method === 'POST');
const plansPath = '/v1/plans?status=active&page=1&pageSize=100';
const quotaPath = '/v1/metrics/tenants/platform/quotas';
const overviewPath = '/v1/metrics/tenants/platform/overview';
function allowlisted(request) {
  if (request.method === 'POST') return ['/v1/tenants', '/v1/auth/login-sessions/synthetic-session/refresh'].includes(request.path);
  return request.method === 'GET' && [plansPath, quotaPath, overviewPath, '/v1/tenants?page%5Bsize%5D=100&sort=displayName', '/v1/tenants/synthetic-tenant',
    ...['t1', 't2', 't3', 'synthetic-tenant'].map((id) => `/v1/workspaces?page%5Bsize%5D=100&sort=displayName&filter%5BtenantId%5D=${id}`)].includes(request.path);
}
async function open(p, variants = {}, inventory = {}) {
  p.inventory = inventory;
  await p.open(manifest.route, variants);
}
async function wizard(p) {
  await button(p, 'create').click();
  await expect(p.page.getByLabel(copy(p).name, { exact: true })).toBeVisible();
}
async function choose(p, key, label) {
  await p.page.getByRole('combobox', { name: copy(p)[key], exact: true }).click();
  await p.page.getByRole('option', { name: label, exact: true }).click();
}
async function summary(p) {
  await wizard(p);
  await p.page.getByLabel(copy(p).name, { exact: true }).fill(tenantBody.name);
  await button(p, 'next').click();
  await choose(p, 'planId', 'Starter (starter)');
  await button(p, 'next').click();
  await choose(p, 'region', copy(p).euWest);
  await button(p, 'next').click();
  await expect(p.page.getByRole('heading', { name: copy(p).summary, exact: true })).toBeVisible();
}
async function capture(p, info, name) {
  await check.assertLocale(p);
  const image = await p.page.screenshot({ fullPage: true, animations: 'disabled' });
  const digest = createHash('sha256').update(image).digest('hex');
  await info.attach(`${name}-${p.locale}-${digest}`, { body: image, contentType: 'image/png' });
}

for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`consoleTenants | superadmin | ${locale} | ${width}`, () => {
    test.use({ role: 'superadmin', locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test.beforeEach(async ({ parity: p }) => {
      p.inventory = {};
      p.keys = [];
      p.page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/v1/tenants' && request.method() === 'POST') p.keys.push(request.headers()['idempotency-key']);
      });
      // Use the approved no-membership platform fixture, so all three inventory rows are accessible.
      await p.page.route(/\/assets\/app-[^/]+\.js$/, async (route) => {
        await p.page.evaluate((role) => {
          const key = 'in-falcone.console-shell-session';
          const session = JSON.parse(sessionStorage.getItem(key));
          session.principal.tenantIds = []; session.principal.workspaceIds = []; session.principal.platformRoles = [role];
          localStorage.setItem('in-falcone.console-active-context', JSON.stringify({ userId: session.principal.userId, tenantId: 't1', workspaceId: null, updatedAt: '2026-06-01T12:00:00Z' }));
          sessionStorage.setItem(key, JSON.stringify(session));
        }, p.testRole ?? 'superadmin');
        await route.fallback();
      });
      await p.page.route((url) => url.pathname === '/v1/tenants' && url.search.startsWith('?page%5Bsize%5D='), async (route) => {
        p.network.requests.push({ method: route.request().method(), path: new URL(route.request().url()).pathname + new URL(route.request().url()).search, body: undefined });
        const fixture = p.inventory;
        if (fixture.delay) await new Promise((done) => setTimeout(done, fixture.delay));
        if (fixture.network) { await route.abort('failed'); return; }
        if (fixture.status) { await route.fulfill({ status: fixture.status, json: { requestId: 'req_inventory', message: 'PRIVATE_MARKER' } }); return; }
        await route.fulfill({ json: { items: fixture.empty ? [] : fixture.truncated ? Array.from({ length: 100 }, (_, index) => ({ tenantId: `t${index + 1}`, displayName: `Organization ${index + 1}`, slug: `org-${index + 1}`, state: 'active' })) : tenantRows, page: { after: fixture.truncated ? 'next' : null } } });
      });
      await p.page.route((url) => url.pathname === '/v1/workspaces' && ['t1', 't2', 't3'].includes(url.searchParams.get('filter[tenantId]')), async (route) => {
        const url = new URL(route.request().url());
        p.network.requests.push({ method: 'GET', path: url.pathname + url.search, body: undefined });
        await route.fulfill({ json: { items: [], page: { after: null } } });
      });
      const injected = [];
      p.page.on('response', (response) => {
        if ([quotaPath, overviewPath, '/v1/tenants', '/v1/plans'].includes(new URL(response.url()).pathname) && response.status() >= 400) injected.push({ url: response.url(), kind: String(response.status()) });
      });
      p.page.on('requestfailed', (request) => {
        if ([quotaPath, overviewPath, '/v1/tenants', '/v1/plans'].includes(new URL(request.url()).pathname) && request.failure()?.errorText === 'net::ERR_FAILED') injected.push({ url: request.url(), kind: 'network' });
      });
      p.page.on('console', (message) => {
        if (message.type() !== 'error' || !consumeResourceDiagnostic(message.text(), message.location().url, injected)) return;
        const index = p.faults.indexOf(`console.error: ${message.text()}`);
        if (index >= 0) p.faults.splice(index, 1);
      });
    });
    test.afterEach(async ({ parity: p }) => {
      expect(p.network.requests.filter((request) => !allowlisted(request)), 'Page request allowlist').toEqual([]);
      expect(allowlisted({ method: 'GET', path: '/v1/tenants/t1/plan' })).toBe(false);
    });
    test('data', async ({ parity: p }) => {
      await open(p);
      await expect(p.page.getByRole('rowheader')).toHaveCount(3);
      await expect(p.page.getByRole('row', { current: true })).toContainText('Alpha');
      await expect(p.page.getByText(copy(p).active, { exact: true })).toBeVisible();
      await expect(p.page.getByText(copy(p).status.suspended, { exact: true })).toBeVisible();
      await expect(p.page.getByText(locale === 'es' ? '3 organizaciones' : '3 organizations', { exact: true })).toBeVisible();
      expect(calls(p, plansPath)).toHaveLength(0); expect(writes(p)).toHaveLength(0);
      expect(calls(p, quotaPath)).toHaveLength(1); expect(calls(p, overviewPath)).toHaveLength(1);
      await open(p, {}, { truncated: true });
      await expect(p.page.getByText(locale === 'es' ? '100+ organizaciones' : '100+ organizations', { exact: true })).toBeVisible();
      await expect(p.page.getByText(copy(p).truncatedNote.replace('{count}', '100'), { exact: true })).toBeVisible();
      await check.assertLocale(p);
      p.testRole = 'tenant_owner';
      const quotaStart = calls(p, quotaPath).length, overviewStart = calls(p, overviewPath).length, planStart = calls(p, plansPath).length;
      await open(p); await expect(p.page.getByRole('heading', { name: copy(p).restricted, exact: true })).toBeVisible();
      await expect.poll(() => calls(p, quotaPath).length).toBe(quotaStart + 1); expect(calls(p, overviewPath)).toHaveLength(overviewStart + 1);
      await button(p, 'create').click(); await expect(p.page.getByRole('heading', { name: copy(p).blocked, exact: true })).toBeVisible();
      expect(calls(p, plansPath)).toHaveLength(planStart);
    });
    test('action', async ({ parity: p }) => {
      for (const variant of ['success', 'delayed', '500-then-success', '500-then-delayed-success', 'network-then-success']) {
        await open(p, { 'tenants.create': variant });
        const start = writes(p).length, keyStart = p.keys.length;
        await summary(p);
        expect(calls(p, quotaPath).length).toBe(calls(p, overviewPath).length);
        await button(p, 'createTenant').click();
        const retry = !['success', 'delayed'].includes(variant);
        if (retry) await button(p, 'retry').click();
        if (variant.includes('delayed')) {
          await expect(button(p, 'creating')).toBeDisabled(); await expect(button(p, 'back')).toBeDisabled();
          await expect(button(p, 'creating')).toHaveAttribute('aria-busy', 'true');
          await expect(p.page.getByRole('dialog', { name: copy(p).create, exact: true }).getByText(tenantBody.name, { exact: true })).toBeVisible();
          await button(p, 'creating').evaluate((element) => element.click());
        }
        await expect(p.page.getByRole('link', { name: copy(p).openCreated, exact: true })).toHaveAttribute('href', '/console/tenants/created/plan');
        const sent = writes(p).slice(start);
        expect(sent).toHaveLength(retry ? 2 : 1);
        for (const request of sent) expect(request.body).toEqual(tenantBody);
        if (retry) expect(p.keys[keyStart]).toBe(p.keys[keyStart + 1]);
      }
      await open(p, { 'tenants.create': '500' }); await summary(p); await button(p, 'createTenant').click(); await button(p, 'retry').waitFor();
      const key = p.keys.at(-1);
      await button(p, 'back').click(); await choose(p, 'region', copy(p).usEast); await button(p, 'next').click(); await button(p, 'createTenant').click();
      await button(p, 'retry').waitFor(); expect(p.keys.at(-1)).not.toBe(key);
      await button(p, 'exit').click(); await expect(button(p, 'create')).toBeFocused();
      const metrics = calls(p, quotaPath).length;
      await wizard(p); await button(p, 'exit').click(); await wizard(p);
      expect(calls(p, quotaPath)).toHaveLength(metrics);
      p.testRole = 'platform_operator'; await open(p);
      await p.page.getByRole('button', { name: copy(p).useActiveName.replace('{name}', 'Beta'), exact: true }).click();
      await expect(p.page.getByRole('button', { name: copy(p).alreadyActive.replace('{name}', 'Beta'), exact: true })).toBeDisabled();
      await expect(p.page.getByRole('row', { current: true })).toContainText('Beta');
      await expect(p.page.getByText(copy(p).activated.replace('{name}', 'Beta'), { exact: true }).first()).toBeAttached();
      p.testRole = 'superadmin'; await open(p);
      await p.page.route((url) => url.pathname === '/console/tenants/t1/plan', (route) => route.fulfill({ contentType: 'text/html', body: `<html lang="${locale}"><body><main><h1>Alpha</h1></main></body></html>` }));
      await p.page.getByRole('link', { name: copy(p).openPlanName.replace('{name}', 'Alpha'), exact: true }).click();
      await expect(p.page).toHaveURL(/\/console\/tenants\/t1\/plan$/);
      expect(await p.page.evaluate(() => JSON.parse(localStorage.getItem('in-falcone.console-active-context')).tenantId)).toBe('t1');
    });
    test('error-empty', async ({ parity: p }) => {
      test.setTimeout(180_000);
      await open(p, {}, { empty: true }); await expect(p.page.getByRole('heading', { name: copy(p).empty, exact: true })).toBeVisible();
      const loading = open(p, {}, { delay: 1000 });
      await expect(p.page.getByRole('status', { name: copy(p).loading, exact: true })).toBeVisible(); await loading;
      await open(p, { 'tenants.plans': 'empty' }); await wizard(p);
      await p.page.getByLabel(copy(p).name, { exact: true }).fill(tenantBody.name); await button(p, 'next').click();
      await expect(p.page.getByText(copy(p).plansEmpty, { exact: true })).toBeVisible(); await expect(button(p, 'next')).toBeDisabled();
      for (const status of [403, 404, 500, 'network']) {
        await open(p, {}, status === 'network' ? { network: true } : { status });
        const heading = status === 403 ? 'noAccess' : status === 404 ? 'notFound' : 'error';
        await expect(p.page.getByRole('heading', { name: copy(p).inventory[heading], exact: true })).toBeVisible();
        p.inventory = {}; await button(p, 'retry').click(); await expect(p.page.getByRole('rowheader')).toHaveCount(3);
      }
      for (const endpoint of ['tenants.plans', 'tenants.quotas', 'tenants.overview']) for (const status of ['403', '404', '500', 'network']) {
        await open(p, { [endpoint]: status }); await wizard(p);
        await p.page.getByLabel(copy(p).name, { exact: true }).fill(tenantBody.name); await button(p, 'next').click();
        const area = endpoint === 'tenants.plans' ? 'catalog' : 'precheck';
        const heading = status === '403' ? 'noAccess' : status === '404' ? 'notFound' : 'error';
        await expect(p.page.getByRole('heading', { name: copy(p)[area][heading], exact: true })).toBeVisible();
        if (area === 'catalog') await expect(button(p, 'next')).toBeDisabled(); else await expect(button(p, 'next')).toBeEnabled();
        p.network.setVariants({}); await button(p, area === 'catalog' ? 'retry' : 'retryPrecheck').click();
        await expect(p.page.getByRole('heading', { name: copy(p)[area][heading], exact: true })).toHaveCount(0);
      }
      for (const status of ['403', '404', '409', '422', '500', 'network']) {
        await open(p, { 'tenants.create': status }); await summary(p); await button(p, 'createTenant').click();
        await expect(p.page.getByRole('dialog', { name: copy(p).create, exact: true }).getByRole('heading', { name: status === '403' ? copy(p).submit.noAccess : status === '404' ? copy(p).submit.notFound : copy(p).submit.error, exact: true })).toBeVisible();
        await expect(p.page.getByText(tenantBody.name, { exact: true })).toBeVisible();
        if (status === '403' || status === '404') await button(p, 'closeWizard').click(); else await button(p, 'exit').click();
        await expect(button(p, 'create')).toBeFocused();
      }
      for (const endpoint of ['tenants.plans', 'tenants.quotas', 'tenants.overview']) {
        await open(p, { [endpoint]: ['401', 'success'] }); await wizard(p);
        await p.page.getByLabel(copy(p).name, { exact: true }).fill(tenantBody.name); await button(p, 'next').click();
        await expect(button(p, 'next')).toBeEnabled();
        await expect.poll(() => calls(p, endpoint === 'tenants.plans' ? plansPath : endpoint === 'tenants.quotas' ? quotaPath : overviewPath).length).toBeGreaterThan(1);
      }
      await open(p, { 'tenants.create': '401-then-success' }); await summary(p); const start = writes(p).length;
      await button(p, 'createTenant').click(); await expect(p.page.getByText(copy(p).sessionRenewed, { exact: true })).toBeVisible();
      expect(writes(p)).toHaveLength(start + 1); await button(p, 'createTenant').click();
      await expect(p.page.getByRole('link', { name: copy(p).openCreated })).toBeVisible(); expect(writes(p)).toHaveLength(start + 2);
    });
    test('accessibility', async ({ parity: p }) => {
      await open(p); await check.assertAccessibility(p); await wizard(p);
      await button(p, 'next').click(); await expect(p.page.getByLabel(copy(p).name, { exact: true })).toHaveAttribute('aria-invalid', 'true');
      await check.assertAccessibility(p); await p.page.keyboard.press('Escape'); await expect(button(p, 'create')).toBeFocused();
      for (const status of ['403', '404', '500']) {
        await open(p, { 'tenants.create': status }); await summary(p); await check.assertAccessibility(p); await button(p, 'createTenant').click();
        await expect(p.page.getByRole('dialog', { name: copy(p).create, exact: true }).getByRole('heading', { name: copy(p).submit[status === '403' ? 'noAccess' : status === '404' ? 'notFound' : 'error'], exact: true })).toBeFocused();
        await check.assertAccessibility(p);
      }
      await check.assertLocale(p);
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
    test('runtime-health', async ({ parity: p }) => {
      await open(p, { 'tenants.create': '500-then-success', 'tenants.plans': ['500', 'success'], 'tenants.overview': ['500', 'success'] });
      await wizard(p); await p.page.getByLabel(copy(p).name, { exact: true }).fill(tenantBody.name); await button(p, 'next').click();
      await button(p, 'retry').click(); await button(p, 'retryPrecheck').click();
      await choose(p, 'planId', 'Starter (starter)'); await button(p, 'next').click(); await choose(p, 'region', copy(p).euWest); await button(p, 'next').click();
      await button(p, 'createTenant').click(); await button(p, 'retry').click(); await expect(p.page.getByRole('link', { name: copy(p).openCreated })).toBeVisible();
      await check.assertRuntimeHealth(p);
    });
    test('responsive', async ({ parity: p }) => {
      await open(p, { 'tenants.create': '500', 'tenants.quotas': '500' }); await check.assertResponsive(p, width);
      await summary(p); await button(p, 'createTenant').click(); await button(p, 'retry').waitFor(); await check.assertResponsive(p, width);
    });
    test('visual-review', async ({ parity: p }, info) => {
      await open(p); await capture(p, info, 'inventory'); await open(p, {}, { truncated: true }); await capture(p, info, 'truncated');
      await open(p, {}, { status: 404 }); await expect(p.page.getByRole('heading', { name: copy(p).inventory.notFound, exact: true })).toBeVisible(); await capture(p, info, 'inventory-not-found');
      p.testRole = 'tenant_owner'; await open(p); await capture(p, info, 'restricted'); p.testRole = 'superadmin';
      await open(p); await wizard(p); await capture(p, info, 'name-step');
      await p.page.getByLabel(copy(p).name, { exact: true }).fill(tenantBody.name); await button(p, 'next').click();
      await capture(p, info, 'plan-step'); await choose(p, 'planId', 'Starter (starter)'); await button(p, 'next').click(); await capture(p, info, 'region-step');
      for (const status of ['404', '500']) {
        await open(p, { 'tenants.plans': status, 'tenants.quotas': '500' }); await wizard(p);
        await p.page.getByLabel(copy(p).name, { exact: true }).fill(tenantBody.name); await button(p, 'next').click();
        await expect(p.page.getByRole('heading', { name: copy(p).catalog[status === '404' ? 'notFound' : 'error'], exact: true })).toBeVisible();
        await capture(p, info, `catalog-${status}-precheck-error`);
      }
      for (const status of ['403', '404', '500', 'success']) {
        await open(p, { 'tenants.create': status }); await summary(p); await capture(p, info, `summary-${status}`); await button(p, 'createTenant').click();
        if (status === 'success') await expect(p.page.getByRole('link', { name: copy(p).openCreated })).toBeVisible(); else await expect(p.page.getByRole('dialog', { name: copy(p).create, exact: true }).getByRole('heading', { name: copy(p).submit[status === '403' ? 'noAccess' : status === '404' ? 'notFound' : 'error'], exact: true })).toBeVisible();
        await capture(p, info, `submit-${status}`);
      }
    });
  });
}
