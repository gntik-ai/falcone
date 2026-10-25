import { createHash } from 'node:crypto';
import manifest, { listBody, reconciliationBody, operations } from './console-operations.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';

const copy = (parity, es, en) => parity.locale === 'es' ? es : en;
const next = (p) => p.page.getByRole('button', { name: copy(p, 'Siguiente', 'Next'), exact: true });
const previous = (p) => p.page.getByRole('button', { name: copy(p, 'Anterior', 'Previous'), exact: true });
const retry = (p) => p.page.getByRole('button', { name: copy(p, 'Reintentar', 'Retry'), exact: true });
const terminalCopy = (p) => copy(p, '1 operación completada mientras estabas desconectado.', '1 operation completed while you were offline.');
const requests = (p) => p.network.requests.filter((r) => r.path === '/v1/async-operation-query' && r.body?.queryType === 'list');
const reconnectRequests = (p) => p.network.requests.filter((r) => r.path === '/v1/console/session' || Array.isArray(r.body?.filters?.status));
const caption = (p) => p.page.locator('.console-operations caption');
async function choose(p, labels, option) {
  const control = p.page.getByRole('combobox', { name: copy(p, ...labels), exact: true });
  await control.click();
  await p.page.getByRole('option', { name: option, exact: true }).click();
  return control;
}
async function settle(p) {
  await expect(p.page.locator('.console-operations')).toBeVisible();
  await expect(p.page.locator('.console-operations [aria-busy="true"]')).toHaveCount(0);
  await expect(p.page.getByRole('region', { name: copy(p, 'Contexto activo', 'Active context'), exact: true })).toHaveAttribute('aria-busy', 'false');
}
async function freeze(p) {
  const time = new Date('2026-06-01T12:00:00Z');
  await p.page.clock.install({ time });
  await p.page.clock.pauseAt(time);
}
async function event(p, name = 'online') {
  await p.page.evaluate((name) => {
    if (name === 'online') window.dispatchEvent(new Event('online'));
    else {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: name });
      document.dispatchEvent(new Event('visibilitychange'));
    }
  }, name);
}
async function reconnect(p, variant = 'delta-updated', name = 'online') {
  const start = p.network.requests.length;
  p.network.setVariants({ 'ops.list': variant });
  await event(p, name);
  await p.page.clock.runFor(499);
  expect(p.network.requests.slice(start)).toEqual([]);
  await p.page.clock.runFor(1);
  await expect.poll(() => p.network.requests.slice(start).length).toBeGreaterThanOrEqual(2);
  return start;
}
for (const role of manifest.roles) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-operations | ${role} | ${locale} | ${width}`, () => {
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test.beforeEach(async ({ parity, server }) => {
      const originalOpen = parity.open;
      parity.open = async (route, variants = {}) => {
        await originalOpen(route, variants);
        await settle(parity);
      };
    });
    test('data', async ({ parity }) => {
      await check.data(parity, manifest);
      await expect(parity.page.locator('tbody tr')).toHaveCount(20);
      expect(requests(parity)[0].body).toEqual(listBody());
      await expect(previous(parity)).toBeDisabled();
      const types = parity.page.getByRole('combobox', { name: copy(parity, 'Tipo de operación', 'Operation type'), exact: true });
      await types.click();
      await expect(parity.page.getByRole('option')).toHaveText([copy(parity, 'Todos', 'All'), 'synthetic-bucket-create', 'synthetic-workspace-create', 'synthetic-workspace-delete']);
      await parity.page.keyboard.press('Escape');
      const formatted = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(operations[0].createdAt));
      await expect(parity.page.locator('tbody tr:first-child td').last()).toHaveText(formatted);
      await expect(parity.page.locator('tbody tr:nth-child(2) td').nth(3)).toHaveText('—');
    });
    test('action', async ({ parity }) => {
      await check.action(parity, manifest);
      await parity.open(manifest.route);
      await next(parity).click();
      await expect(parity.page.locator('tbody tr:first-child a')).toHaveAttribute('href', /\/op_21$/);
      await expect(parity.page.locator('.console-operations p[aria-live]')).toHaveText(copy(parity, '21–40 de 45', '21–40 of 45'));
      const selected = await choose(parity, ['Estado', 'Status'], copy(parity, 'En curso', 'Running'));
      await expect.poll(() => requests(parity).at(-1).body).toEqual(listBody({ status: 'running' }));
      await expect(selected).toBeFocused();
      await choose(parity, ['Tipo de operación', 'Operation type'], 'synthetic-bucket-create');
      await expect.poll(() => requests(parity).at(-1).body).toEqual(listBody({ status: 'running', operationType: 'synthetic-bucket-create' }));
      await choose(parity, ['Tipo de operación', 'Operation type'], copy(parity, 'Todos', 'All'));
      const workspace = parity.page.getByRole('textbox', { name: copy(parity, 'Área de trabajo', 'Workspace'), exact: true });
      await workspace.fill(' wrk_a ');
      await expect.poll(() => requests(parity).at(-1).body).toEqual(listBody({ status: 'running', workspaceId: 'wrk_a' }));
      await expect(workspace).toBeFocused();
      await expect(parity.page.getByRole('heading', { name: copy(parity, 'No se encontraron operaciones.', 'No operations found.'), exact: true })).toBeVisible();
      await workspace.fill('');
      await expect.poll(() => requests(parity).at(-1).body).toEqual(listBody({ status: 'running' }));
      await choose(parity, ['Estado', 'Status'], copy(parity, 'Todos', 'All'));
      await expect.poll(() => requests(parity).at(-1).body).toEqual(listBody());
      await parity.open(manifest.route);
      await parity.page.locator('tbody tr:first-child a').focus();
      await parity.page.keyboard.press('Enter');
      await expect(parity.page).toHaveURL(/\/console\/operations\/op_1$/);
      await expect(parity.page.getByRole('heading', { name: copy(parity, 'Detalle de operación', 'Operation detail'), exact: true })).toBeVisible();
    });
    test('error-empty', async ({ parity, server }) => {
      await check.errorEmpty(parity, manifest);
      await parity.open(manifest.route, { 'ops.list': '404' });
      await expect(parity.page.getByRole('link', { name: copy(parity, 'Volver al resumen', 'Back to overview'), exact: true })).toHaveAttribute('href', /\/console\/overview$/);
      parity.network.setVariants({ 'ops.list': { delayMs: 1000 } });
      await parity.page.goto(server.url(manifest.route.slice(1)));
      await expect(parity.page.getByRole('status', { name: copy(parity, 'Cargando operaciones', 'Loading operations'), exact: true })).toBeVisible();
      await settle(parity);
      await freeze(parity);
      await parity.open(manifest.route);
      parity.network.setVariants({ 'ops.list': 'network' });
      await parity.page.clock.runFor(30_000);
      await parity.page.clock.runFor(4000);
      await expect(retry(parity)).toBeVisible();
      await expect(parity.page.getByText(copy(parity, 'La lista no está actualizada. Reintenta para actualizar las operaciones.', 'The list is out of date. Retry to update operations.'), { exact: true })).toBeVisible();
      const count = requests(parity).length;
      await parity.page.clock.runFor(60_000);
      expect(requests(parity)).toHaveLength(count);
    });
    test('accessibility', async ({ parity }) => {
      for (const variants of [{}, { 'ops.list': 'empty' }, { 'ops.list': '403' }, { 'ops.list': '404' }, { 'ops.list': '500' }]) {
        await parity.open(manifest.route, variants);
        if (variants['ops.list'] === '500') await expect(retry(parity)).toBeVisible();
        await check.assertAccessibility(parity);
        await check.assertLocale(parity);
      }
      await parity.open(manifest.route);
      await next(parity).click();
      await expect(parity.page.locator('tbody tr:first-child a')).toHaveAttribute('href', /\/op_21$/);
      await expect(next(parity)).toBeFocused();
      await expect(parity.page.locator('.console-operations p[aria-live]')).toHaveText(copy(parity, '21–40 de 45', '21–40 of 45'));
      await next(parity).click();
      await expect(parity.page.locator('tbody tr:first-child a')).toHaveAttribute('href', /\/op_41$/);
      await expect(next(parity)).toBeDisabled();
      await expect(parity.page.locator('.console-operations [aria-current="page"]')).toBeFocused();
      await freeze(parity);
      await parity.open(manifest.route, { 'ops.list': 'with-running' });
      await reconnect(parity);
      await expect(parity.page.getByText(terminalCopy(parity), { exact: true })).toBeVisible();
      await check.assertAccessibility(parity);
      await parity.page.getByRole('button', { name: copy(parity, 'Cerrar', 'Close'), exact: true }).click();
      await expect(caption(parity)).toBeFocused();
    });
    test('runtime-health', async ({ parity }) => {
      await freeze(parity);
      await parity.open(manifest.route, { 'ops.list': 'with-running' });
      const start = requests(parity).length;
      await parity.page.clock.runFor(29_999); expect(requests(parity)).toHaveLength(start);
      await parity.page.clock.runFor(1); await expect.poll(() => requests(parity).length).toBe(start + 1);
      const beforeSync = await reconnect(parity);
      await expect(parity.page.getByText(terminalCopy(parity), { exact: true })).toBeVisible();
      expect(parity.network.requests.slice(beforeSync)).toEqual([
        { method: 'GET', path: '/v1/console/session', body: undefined },
        { method: 'POST', path: '/v1/async-operation-query', body: reconciliationBody() },
        { method: 'POST', path: '/v1/async-operation-query', body: listBody() },
      ]);
      await parity.page.clock.runFor(29_000); await expect(parity.page.getByText(terminalCopy(parity), { exact: true })).toBeVisible();
      await parity.page.clock.runFor(1000); await expect(parity.page.getByText(terminalCopy(parity), { exact: true })).toHaveCount(0);
      await parity.open(manifest.route, { 'ops.list': 'with-running' });
      const unchanged = await reconnect(parity, 'unchanged', 'visible');
      await parity.page.clock.runFor(1000);
      expect(parity.network.requests.slice(unchanged)).toHaveLength(2);
      const hidden = reconnectRequests(parity).length;
      await event(parity, 'hidden'); await parity.page.clock.runFor(2000);
      expect(reconnectRequests(parity)).toHaveLength(hidden);
      await event(parity, 'visible'); // Restore visibility before the next navigation.
      await parity.open(manifest.route, { 'ops.list': 'all-completed' });
      const terminal = requests(parity).length; await parity.page.clock.runFor(30_000); expect(requests(parity)).toHaveLength(terminal);
      await check.assertRuntimeHealth(parity);
    });
    test('responsive', async ({ parity }) => {
      await parity.open(manifest.route);
      await check.assertResponsive(parity, width);
      await next(parity).click();
      await expect(parity.page.locator('tbody tr:first-child a')).toHaveAttribute('href', /\/op_21$/);
      await expect(parity.page.locator('.console-operations p[aria-live]')).toHaveText(copy(parity, '21–40 de 45', '21–40 of 45'));
      await check.assertResponsive(parity, width);
      if (width === 375) {
        const fields = await parity.page.locator('.console-operations-toolbar .grid > div').evaluateAll((items) => items.map((item) => item.getBoundingClientRect().top));
        expect(fields[1]).toBeGreaterThan(fields[0]); expect(fields[2]).toBeGreaterThan(fields[1]);
      }
    });
    test('visual-review', async ({ parity }, info) => {
      for (const [state, variant] of [['populated', '45-mixed'], ['delta', 'with-running'], ['empty', 'empty'], ['error', '500']]) {
        await parity.open(manifest.route, { 'ops.list': variant });
        if (state === 'delta') {
          parity.network.setVariants({ 'ops.list': 'delta-updated' });
          await event(parity);
          await expect(parity.page.getByText(terminalCopy(parity), { exact: true })).toBeVisible();
        }
        if (state === 'error') {
          await expect(retry(parity)).toBeVisible();
        }
        await check.assertLocale(parity);
        const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
        const hash = createHash('sha256').update(body).digest('hex');
        await info.attach(`${state}-${locale}-${width}-sha256-${hash}`, { body, contentType: 'image/png' });
      }
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
  });
  // Additional journeys stay outside the eight-check report shape.
  test.describe(`operations lifecycle (${role}, ${locale}, ${width})`, () => {
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test('401 uses the shared refresh and protected-route intent', async ({ parity, server }) => {
      parity.network.setVariants({ 'ops.list': '401' });
      await parity.page.goto(server.url(manifest.route.slice(1)));
      await expect(parity.page).toHaveURL(/\/login$/);
      expect(parity.network.requests.filter((r) => r.method === 'POST' && r.path === '/v1/auth/login-sessions/synthetic-session/refresh')).toHaveLength(1);
      expect(await parity.page.evaluate(() => sessionStorage.getItem('in-falcone.console-protected-route'))).toBe('/next/console/operations');
    });
    test('retry timing and filtered offset survive automatic and manual recovery', async ({ parity }) => {
      await freeze(parity);
      await parity.open(manifest.route, { 'ops.list': '45-running' }); await settle(parity);
      await choose(parity, ['Estado', 'Status'], copy(parity, 'En curso', 'Running'));
      await expect.poll(() => requests(parity).at(-1).body).toEqual(listBody({ status: 'running' }));
      await settle(parity);
      for (const variant of ['500-then-success', 'network-then-success']) {
        parity.network.setVariants({ 'ops.list': variant });
        const start = requests(parity).length;
        await next(parity).click();
        await expect.poll(() => requests(parity).length).toBe(start + 1);
        await parity.page.clock.runFor(999); expect(requests(parity)).toHaveLength(start + 1);
        await parity.page.clock.runFor(1); await expect.poll(() => requests(parity).length).toBe(start + 2);
        await parity.page.clock.runFor(2999); expect(requests(parity)).toHaveLength(start + 2);
        await parity.page.clock.runFor(1); await expect(retry(parity)).toBeVisible();
        expect(requests(parity).slice(start).map((r) => r.body)).toEqual(Array(3).fill(listBody({ status: 'running' }, 20)));
        await retry(parity).click(); await expect(caption(parity)).toBeFocused();
        expect(requests(parity).at(-1).body).toEqual(listBody({ status: 'running' }, 20));
        await previous(parity).click();
        await expect(parity.page.locator('.console-operations [aria-current="page"]')).toHaveAttribute('aria-label', copy(parity, 'Página 1', 'Page 1'));
        await expect(parity.page.locator('tbody tr:first-child a')).toHaveAttribute('href', /\/op_1$/);
        await settle(parity);
      }
    });
    test('reconnect pages to total and the build flag controls only the callout', async ({ parity }) => {
      await freeze(parity);
      await parity.open(manifest.route, { 'ops.list': 'with-running' }); await settle(parity);
      const start = await reconnect(parity, 'paged-reconciliation');
      await expect.poll(() => parity.network.requests.slice(start).length).toBe(4);
      expect(parity.network.requests.slice(start)).toEqual([
        { method: 'GET', path: '/v1/console/session', body: undefined },
        { method: 'POST', path: '/v1/async-operation-query', body: reconciliationBody() },
        { method: 'POST', path: '/v1/async-operation-query', body: reconciliationBody(100) },
        { method: 'POST', path: '/v1/async-operation-query', body: listBody() },
      ]);
      const message = parity.page.getByText(copy(parity, '100 nuevas operaciones detectadas al reconectar.', '100 new operations detected on reconnect.'), { exact: true });
      if (process.env.VITE_CONSOLE_RECONNECT_SYNC_ENABLED === 'false') await expect(message).toHaveCount(0);
      else await expect(message).toBeVisible();
    });
    test('no active tenant adds zero reconnect traffic after initial data', async ({ parity, server }) => {
      await freeze(parity);
      const tenantFixture = role === 'tenant_owner' ? 'tenant' : 'tenants';
      parity.network.setVariants({ [tenantFixture]: 'empty', 'ops.list': 'with-running' });
      // Use goto: empty context is intentional and the shell still settles.
      await parity.page.goto(server.url(manifest.route.slice(1)));
      await settle(parity);
      await expect(parity.page.locator('tbody tr')).toHaveCount(1);
      const start = reconnectRequests(parity).length;
      await event(parity); await event(parity, 'visible');
      await parity.page.clock.runFor(2000);
      expect(reconnectRequests(parity)).toHaveLength(start);
    });
    test('unmount cancels debounce and aborts pending session and reconciliation traffic', async ({ parity }) => {
      await freeze(parity);
      for (const stage of ['debounce', 'session', 'reconciliation']) {
        await parity.open(manifest.route, { 'ops.list': 'with-running' }); await settle(parity);
        const aborted = [];
        const onFailed = (request) => { if (request.failure()?.errorText.includes('ABORTED')) aborted.push(request.url()); };
        parity.page.on('requestfailed', onFailed);
        let release;
        let holding = false;
        const held = new Promise((resolve) => { release = resolve; });
        const routePattern = stage === 'session' ? '**/v1/console/session' : '**/v1/async-operation-query';
        const hold = async (route) => {
          if (stage === 'reconciliation' && !Array.isArray(route.request().postDataJSON()?.filters?.status)) return route.fallback();
          holding = true;
          await held; await route.fallback().catch(() => {});
        };
        if (stage !== 'debounce') await parity.page.route(routePattern, hold);
        const start = reconnectRequests(parity).length;
        await event(parity);
        if (stage !== 'debounce') {
          await parity.page.clock.runFor(500);
          await expect.poll(() => holding).toBe(true);
        }
        // The migrated operation-detail link unmounts the list without destroying the monitor.
        await parity.page.locator('tbody tr:first-child a').click();
        await expect(parity.page).toHaveURL(/\/console\/operations\/op_1$/);
        release();
        await parity.page.clock.runFor(2000);
        if (stage === 'debounce') expect(reconnectRequests(parity)).toHaveLength(start);
        else await expect.poll(() => aborted.length).toBeGreaterThan(0);
        if (stage !== 'debounce') await parity.page.unroute(routePattern, hold);
        parity.page.off('requestfailed', onFailed);
        await check.assertRuntimeHealth(parity);
      }
    });
  });
}
