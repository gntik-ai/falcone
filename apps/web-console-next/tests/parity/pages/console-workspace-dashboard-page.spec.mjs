import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { consumption } from './console-workspace-dashboard-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';

const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale,
  JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-workspace-dashboard-page.json`, import.meta.url), 'utf8')),
]));
const path = `/v1/workspaces/${consumption.workspaceId}/consumption`;
const surface = (parity) => parity.page.locator('.workspace-dashboard');
const calls = (parity) => parity.network.requests.filter((request) => request.path.endsWith('/consumption'));
const endpoints = {
  ...manifest.endpoints,
  consumptionA: { method: 'GET', path: '/v1/workspaces/a/consumption', fixtures: { success: { status: 200, body: { ...consumption, workspaceId: 'a' }, delayMs: 2000 } } },
  consumptionB: { method: 'GET', path: '/v1/workspaces/b/consumption', fixtures: { success: { status: 200, body: { ...consumption, workspaceId: 'b' } } } },
  consumptionEncoded: { method: 'GET', path: '/v1/workspaces/synthetic%2Fwith%20space/consumption', fixtures: { success: { status: 200, body: { ...consumption, workspaceId: 'synthetic/with space' } } } },
};
async function open(parity, variant = 'success') { await parity.open(manifest.route, { workspaceConsumption: variant }); }
function assertReads(parity, count) {
  expect(calls(parity)).toHaveLength(count);
  for (const request of calls(parity)) expect(request).toEqual({ method: 'GET', path, body: undefined });
}
async function keyboardFocus(page, target) {
  await page.evaluate(() => document.activeElement?.blur());
  for (let index = 0; index < 80; index++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((node) => node === document.activeElement)) return;
  }
  throw new Error('Action is not keyboard reachable');
}
for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-workspace-dashboard-page | ${locale} | ${width}`, () => {
    test.use({ locale, role: 'workspace_viewer', viewport: { width, height: 900 }, pageEndpoints: endpoints });
    const copy = bundles[locale];
    test('data', async ({ parity }) => {
      await open(parity);
      const table = surface(parity).getByRole('table', { name: copy.tableTitle, exact: true });
      await expect(table.getByRole('columnheader')).toHaveCount(5);
      await expect(table.getByRole('row')).toHaveCount(4);
      await expect(surface(parity).getByText(consumption.workspaceId, { exact: true })).toBeVisible();
      await expect(surface(parity).getByText(consumption.tenantId, { exact: true })).toBeVisible();
      await expect(surface(parity).locator('time')).toHaveText(new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(consumption.snapshotAt)));
      for (const key of ['override', 'unlimited', 'unavailableData']) await expect(table.getByText(copy[key], { exact: true })).toBeVisible();
      await expect(surface(parity).getByLabel(locale === 'es' ? 'PostgreSQL databases: estado Dentro del límite' : 'PostgreSQL databases: status Within limit', { exact: true })).toBeVisible();
      await expect(surface(parity).getByLabel(locale === 'es' ? 'Synthetic realtime capability: capacidad habilitada' : 'Synthetic realtime capability: capability enabled', { exact: true })).toBeVisible();
      assertReads(parity, 1);
      await check.assertLocale(parity);
    });
    test('action', async ({ parity }) => {
      await open(parity, ['500', 'success']);
      const retry = surface(parity).getByRole('button', { name: copy.retry, exact: true });
      await keyboardFocus(parity.page, retry);
      await parity.page.keyboard.press('Enter');
      await expect(surface(parity).getByRole('table')).toBeVisible();
      assertReads(parity, 2);
      await expect(surface(parity).getByRole('heading', { level: 1 })).toBeFocused();
      for (const status of ['403', '404']) {
        await open(parity, status);
        const back = surface(parity).getByRole('link', { name: copy.myPlan, exact: true });
        await expect(back).toHaveAttribute('href', '/console/my-plan');
        await keyboardFocus(parity.page, back);
        await parity.page.keyboard.press('Enter');
        await expect(parity.page).toHaveURL(/\/console\/my-plan$/);
      }
      await open(parity, 'workspace-consumption.401-refresh-ok');
      await expect(surface(parity).getByRole('table')).toBeVisible();
      expect(parity.network.requests.filter((request) => request.method === 'POST')).toEqual([
        { method: 'POST', path: '/v1/auth/login-sessions/synthetic-session/refresh', body: { refreshToken: 'synthetic-refresh-token' } },
      ]);
    });
    test('error-empty', async ({ parity, server }) => {
      for (const state of manifest.states) {
        await open(parity, state.variant);
        await expect(parity.page.locator(typeof state.locator === 'string' ? state.locator : state.locator[locale])).toBeVisible();
        if (['403', '404', 'empty'].includes(state.variant)) await expect(surface(parity).getByRole('button', { name: copy.retry, exact: true })).toHaveCount(0);
        if (state.variant === '403') await expect(surface(parity).getByRole('button')).toHaveCount(0);
        if (state.variant === '500') await expect(surface(parity).getByText('req_synthetic_workspace_500', { exact: true })).toBeVisible();
      }
      for (const state of ['capabilities-empty', 'capabilities-absent', 'dimensions-empty-capabilities-absent']) {
        await open(parity, `workspace-consumption.${state}`);
        await expect(surface(parity).getByRole('heading', { name: copy.capabilities, exact: true })).toHaveCount(state.endsWith('absent') ? 0 : 1);
        if (state === 'capabilities-empty') await expect(surface(parity).getByRole('status')).toHaveText(copy.capabilitiesEmpty);
      }
      parity.network.setVariants({ workspaceConsumption: 'workspace-consumption.delayed' });
      await parity.page.goto(server.url(manifest.route.slice(1)));
      await expect(surface(parity).getByRole('status', { name: copy.loading, exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('table')).toBeVisible();
      const before = parity.network.requests.filter((request) => request.method === 'POST').length;
      await parity.open(manifest.route, { workspaceConsumption: 'workspace-consumption.401-refresh-fail', refresh: '401' });
      await expect(parity.page).toHaveURL(/\/login$/);
      expect(parity.network.requests.filter((request) => request.method === 'POST')).toHaveLength(before + 1);
      expect(await parity.page.evaluate(() => sessionStorage.getItem('in-falcone.console-shell-session'))).toBeNull();
      expect(await parity.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(manifest.route);
    });
    test('accessibility', async ({ parity }) => {
      await open(parity, ['500', { variant: '500', delayMs: 1000 }, 'success']);
      await keyboardFocus(parity.page, surface(parity).getByRole('link', { name: copy.myPlan, exact: true }));
      await parity.page.keyboard.press('Tab');
      await expect(surface(parity).getByRole('button', { name: copy.retry, exact: true })).toBeFocused();
      await parity.page.keyboard.press('Enter');
      await expect(surface(parity).getByRole('button', { name: copy.retrying, exact: true })).toBeFocused();
      await expect.poll(() => calls(parity).length).toBe(2);
      const retry = surface(parity).getByRole('button', { name: copy.retry, exact: true });
      await expect(retry).toHaveAttribute('aria-busy', 'false');
      await expect(retry).toHaveAttribute('aria-disabled', 'false');
      await expect(retry).toBeFocused();
      assertReads(parity, 2);
      await parity.page.keyboard.press('Enter');
      await expect(surface(parity).getByRole('table')).toBeVisible();
      assertReads(parity, 3);
      await expect(surface(parity).getByRole('heading', { level: 1 })).toBeFocused();
      await expect(surface(parity).getByRole('checkbox')).toHaveCount(0);
      await expect(surface(parity).getByRole('combobox')).toHaveCount(0);
      await expect(surface(parity).getByRole('table').getByRole('button')).toHaveCount(0);
      for (const state of ['success', 'empty', '403', '404', '500']) { await open(parity, state); await check.assertAccessibility(parity); await check.assertLocale(parity); }
      await open(parity, 'workspace-consumption.meter-edges');
      const rows = surface(parity).getByRole('row');
      for (const index of [3, 4, 5, 6]) {
        const meter = rows.nth(index).getByRole('meter');
        expect(await meter.getAttribute('aria-valuenow')).toBe(await meter.getAttribute('aria-valuemax'));
        await expect(rows.nth(index).getByText(copy.over_limit, { exact: true }).first()).toBeVisible();
      }
    });
    test('runtime-health', async ({ parity, server }) => {
      await open(parity);
      await check.assertRuntimeHealth(parity);
      await parity.open('/console/workspaces/synthetic%2Fwith%20space');
      expect(calls(parity).at(-1)).toEqual({ method: 'GET', path: '/v1/workspaces/synthetic%2Fwith%20space/consumption', body: undefined });
      const oldResponse = parity.page.waitForResponse((response) => new URL(response.url()).pathname === '/v1/workspaces/a/consumption');
      await parity.page.goto(server.url('console/workspaces/a'));
      await expect(surface(parity).getByRole('status', { name: copy.loading, exact: true })).toBeVisible();
      await parity.page.evaluate((destination) => {
        window.__workspaceDocument = true;
        history.pushState({}, '', destination);
        dispatchEvent(new PopStateEvent('popstate'));
      }, new URL(server.url('console/workspaces/b')).pathname);
      await expect(surface(parity).getByText('b', { exact: true })).toBeVisible();
      await oldResponse;
      await expect(surface(parity).getByText('a', { exact: true })).toHaveCount(0);
      expect(await parity.page.evaluate(() => window.__workspaceDocument)).toBe(true);
      await check.assertRuntimeHealth(parity);
    });
    test('responsive', async ({ parity }) => {
      for (const variant of ['success', 'empty', 'workspace-consumption.long-identifiers']) { await open(parity, variant); await check.assertResponsive(parity, width); }
      await parity.open('/console/workspaces/synthetic%2Fwith%20space');
      await check.assertResponsive(parity, width);
    });
    test('visual-review', async ({ parity, server }, info) => {
      for (const state of ['success', 'empty', '403', '404', '500', 'workspace-consumption.delayed']) {
        if (state.endsWith('delayed')) {
          parity.network.setVariants({ workspaceConsumption: state });
          await parity.page.goto(server.url(manifest.route.slice(1)));
          await expect(surface(parity).getByRole('status', { name: copy.loading, exact: true })).toBeVisible();
        } else await open(parity, state);
        const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
        await info.attach(`${state}-${locale}-${width}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
      }
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
  });
}
