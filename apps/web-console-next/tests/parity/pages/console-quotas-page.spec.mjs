import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import manifest, { quotasTenant } from './console-quotas-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';

const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-quotas-page.json`, import.meta.url), 'utf8'))]));
const build = JSON.parse(readFileSync(new URL('../../../dist/.vite/manifest.json', import.meta.url), 'utf8'));
const entry = Object.values(build).find((chunk) => chunk.isEntry && chunk.name === 'app').file;
const surface = (parity) => parity.page.locator('.console-quotas');
const dialog = (parity) => parity.page.locator('[role="dialog"][aria-modal="true"]');
const puts = (parity) => parity.network.requests.filter((request) => request.method === 'PUT');
const button = (parity, name) => dialog(parity).getByRole('button', { name, exact: true });
async function open(parity, variants = {}) {
  await parity.open(manifest.route, variants);
  await expect(surface(parity).locator('section[aria-busy="true"]')).toHaveCount(0);
}
function allowlist(parity) {
  for (const request of parity.network.requests) {
    const url = new URL(request.path, 'http://synthetic.test');
    const pageRead = /^\/v1\/(?:metrics\/(?:tenants|workspaces)\/synthetic-[^/]+\/(?:quotas|overview)|tenants\/synthetic-tenant\/plan)$/;
    const shellRead = /^\/v1\/(?:tenants(?:\/synthetic-tenant)?|workspaces|auth\/signups\/policy)$/;
    const refresh = /^\/v1\/auth\/login-sessions\/synthetic-session\/refresh$/;
    if (request.method === 'GET') {
      expect(pageRead.test(url.pathname) || shellRead.test(url.pathname)).toBe(true);
      if (pageRead.test(url.pathname)) expect(url.search).toBe('');
      expect(request.body).toBeUndefined();
    } else if (request.method === 'PUT') {
      expect(url.pathname).toMatch(/^\/v1\/plans\/synthetic-plan\/limits\/[a-z_]+$/);
      expect(Object.keys(request.body)).toEqual(['value']);
      expect(Number.isInteger(request.body.value) && request.body.value >= -1).toBe(true);
    } else {
      expect(request.method).toBe('POST'); expect(url.pathname).toMatch(refresh);
      expect(request.body).toEqual({ refreshToken: 'synthetic-refresh-token' });
    }
  }
}
async function adjust(parity, name = 'Maximum Workspaces') {
  const trigger = surface(parity).getByRole('button', { name: `${parity.locale === 'es' ? 'Ajustar cuota de' : 'Adjust quota for'} ${name}`, exact: true }).first();
  await trigger.click();
  await expect(dialog(parity).getByRole('spinbutton')).toBeFocused();
  return trigger;
}
async function review(parity, copy, value = '500') {
  const trigger = await adjust(parity);
  await dialog(parity).getByRole('spinbutton').fill(value);
  await button(parity, copy.save).click();
  return trigger;
}
async function close(parity, copy) { await button(parity, copy.close).click(); await expect(dialog(parity)).toHaveCount(0); }
async function assertDialogResponsive(parity, width) {
  // A modal removes the background main landmark from accessibility queries.
  await expect(dialog(parity)).toBeVisible();
  const sizes = await parity.page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(sizes.scrollWidth, `responsive: horizontal overflow at ${width}px`).toBeLessThanOrEqual(sizes.clientWidth);
  const bounds = await dialog(parity).boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(parity.page.viewportSize().height);
}
async function keyboardActivate(page, target) {
  await page.evaluate(() => document.activeElement?.blur());
  for (let index = 0; index < 100; index++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((node) => node === document.activeElement)) { await page.keyboard.press('Enter'); return; }
  }
  throw new Error('Action is not reachable by keyboard');
}
// Change only synthetic session roles before the entry chunk executes; do not widen the shared Role union.
async function withRole(parity, server, roles) {
  const seed = async (route) => {
    await parity.page.evaluate((roles) => {
      const session = JSON.parse(sessionStorage.getItem('in-falcone.console-shell-session'));
      session.principal.platformRoles = roles;
      sessionStorage.setItem('in-falcone.console-shell-session', JSON.stringify(session));
    }, roles);
    await route.fallback();
  };
  await parity.page.route(`**/${entry}`, seed);
  try { await parity.page.goto(server.url('console/quotas')); }
  finally { await parity.page.unroute(`**/${entry}`, seed); }
  await expect(surface(parity).getByRole('table').first()).toBeVisible();
}

for (const role of manifest.roles) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-quotas-page | ${role} | ${locale} | ${width}`, () => {
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    const copy = bundles[locale];
    test.afterEach(async ({ parity }) => { allowlist(parity); });
    test('data', async ({ parity }) => {
      const clearPreference = async (route) => {
        await parity.page.evaluate(() => localStorage.removeItem('falcone-next-locale'));
        await route.fallback();
      };
      if (locale === 'en') await parity.page.route(`**/${entry}`, clearPreference);
      try { await open(parity); }
      finally { if (locale === 'en') await parity.page.unroute(`**/${entry}`, clearPreference); }
      await expect(surface(parity).getByRole('table')).toHaveCount(2);
      await expect(surface(parity).getByText('critical', { exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('rowheader')).toHaveCount(9);
      const tenantTable = surface(parity).getByRole('table').first();
      for (const row of quotasTenant.dimensions) await expect(tenantTable.getByRole('rowheader', { name: row.displayName, exact: true })).toBeVisible();
      await expect(tenantTable.getByText(copy.unlimited, { exact: true })).toBeVisible();
      await expect(tenantTable.getByText(copy.exceeded, { exact: true })).toBeVisible();
      await expect(tenantTable.getByRole('meter', { name: locale === 'es' ? 'Uso de Synthetic Requests' : 'Usage for Synthetic Requests' })).toHaveAttribute('aria-valuetext', '110%');
      await expect(surface(parity).locator('time')).toHaveText(new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(quotasTenant.evaluatedAt)));
      const before = parity.network.requests.length;
      const search = surface(parity).getByRole('searchbox').first();
      await search.fill('API'); await expect(tenantTable.getByRole('rowheader')).toHaveCount(1);
      await expect(surface(parity).getByText(locale === 'es' ? '6 dimensiones' : '6 dimensions', { exact: true })).toBeVisible();
      await search.fill('unmatched'); await surface(parity).getByRole('button', { name: copy.clear }).click();
      await expect(search).toBeFocused(); await expect(tenantTable.getByRole('rowheader')).toHaveCount(6);
      expect(parity.network.requests).toHaveLength(before);
      allowlist(parity); await check.assertLocale(parity);
      for (const posture of ['healthy', 'hard_limit_reached', 'soft_limit_exceeded', 'evidence_degraded', 'evidence_unavailable', 'unbounded']) {
        await open(parity, { 'quotas.tenantOverview': posture });
        await expect(surface(parity).getByText(posture.replace(/_/g, ' '), { exact: true })).toBeVisible();
        await check.assertLocale(parity);
      }
    });
    test('action', async ({ parity }) => {
      await open(parity);
      if (role !== 'superadmin') {
        await expect(surface(parity).getByRole('columnheader', { name: copy.action, exact: true })).toHaveCount(0);
        await expect(surface(parity).locator('button[data-quota-adjust-trigger]')).toHaveCount(0);
        for (let index = 0; index < 40; index++) await parity.page.keyboard.press('Tab');
        expect(puts(parity)).toHaveLength(0); allowlist(parity); return;
      }
      await review(parity, copy);
      expect(puts(parity)).toHaveLength(0);
      await expect(dialog(parity)).toContainText('Synthetic Shared Plan');
      await expect(dialog(parity)).toContainText(locale === 'es' ? 'todas las organizaciones' : 'every organization');
      await button(parity, copy.back).click(); await expect(dialog(parity).getByRole('spinbutton')).toHaveValue('500');
      expect(puts(parity)).toHaveLength(0);
      await button(parity, copy.save).click(); await button(parity, copy.confirm).click();
      await expect(button(parity, copy.close)).toBeVisible();
      expect(puts(parity)).toEqual([{ method: 'PUT', path: '/v1/plans/synthetic-plan/limits/max_workspaces', body: { value: 500 } }]);
      await close(parity, copy); await expect(surface(parity).getByRole('table')).toHaveCount(2);
      expect(parity.network.requests.filter((request) => request.path === '/v1/metrics/tenants/synthetic-tenant/quotas')).toHaveLength(2);
      for (const variant of ['tenant-plan-draft', 'tenant-plan-deprecated', 'tenant-plan-archived']) {
        await open(parity, { 'quotas.plan': variant });
        const trigger = surface(parity).getByRole('button', { name: /Maximum Workspaces/ }).first(); await trigger.click();
        if (variant.endsWith('draft')) {
          await dialog(parity).getByRole('spinbutton').fill('500'); await button(parity, copy.save).click(); await button(parity, copy.confirm).click();
          await expect(button(parity, copy.close)).toBeVisible();
        } else {
          await expect(dialog(parity).getByRole('link', { name: copy.openPlan })).toHaveAttribute('href', '/console/plans/synthetic-plan');
          await expect(dialog(parity).getByRole('spinbutton')).toHaveCount(0);
        }
        await close(parity, copy);
      }
      await open(parity, { 'quotas.tenant': ['success', 'quotas-tenant-after-unlimited'], 'quotas.put': 'plan-limit-put-unlimited-ok' });
      await review(parity, copy, '-1'); await button(parity, copy.confirm).click(); await expect(button(parity, copy.close)).toBeVisible();
      await close(parity, copy);
      await expect(surface(parity).getByRole('table').first().getByRole('row').filter({ has: parity.page.getByRole('rowheader', { name: 'Maximum Workspaces', exact: true }) })).toContainText(copy.unlimited);
      for (const variant of ['plan-limit-put-slow', 'plan-limit-put-slow-500']) {
        await open(parity, { 'quotas.put': variant }); await review(parity, copy); await button(parity, copy.confirm).click();
        const before = puts(parity).length;
        await expect(button(parity, copy.cancel)).toBeDisabled(); await expect(button(parity, copy.saving)).toBeDisabled();
        await expect(button(parity, copy.close)).toHaveCount(0); await parity.page.keyboard.press('Escape');
        await parity.page.mouse.click(width - 1, 1); await expect(dialog(parity)).toBeVisible(); expect(puts(parity)).toHaveLength(before);
        if (variant.endsWith('500')) { await expect(button(parity, copy.cancel)).toBeEnabled(); await button(parity, copy.cancel).click(); }
        else { await expect(button(parity, copy.close)).toBeVisible(); await close(parity, copy); }
      }
      allowlist(parity);
    });
    test('error-empty', async ({ parity, server }) => {
      for (const state of manifest.states) {
        await open(parity, { [state.fixture]: state.variant });
        await expect(parity.page.locator(typeof state.locator === 'string' ? state.locator : state.locator[locale])).toBeVisible();
        if (state.variant !== 'empty') await expect(surface(parity).getByRole('table')).toHaveCount(0);
        if (state.variant === '500') await expect(surface(parity).getByText('req_synthetic_quotas_500', { exact: true })).toBeVisible();
        if (state.variant === '404') await expect(surface(parity).getByRole('link', { name: copy.consoleStart })).toHaveAttribute('href', /\/console$/);
      }
      await open(parity, { tenants: 'empty' }); await expect(surface(parity).getByText(copy.blocked, { exact: true })).toBeVisible();
      await open(parity, { workspaces: 'empty' }); await expect(surface(parity).getByRole('table')).toHaveCount(1);
      await open(parity, { 'quotas.workspace': 'empty' });
      const workspace = surface(parity).getByRole('region', { name: copy.workspace });
      await expect(workspace.getByText(locale === 'es' ? '0 dimensiones' : '0 dimensions', { exact: true })).toBeVisible();
      await expect(workspace.getByRole('table')).toBeVisible();
      await expect(workspace.getByRole('rowheader')).toHaveCount(0);
      await expect(workspace.getByText(copy.noResults, { exact: true })).toHaveCount(0);
      await expect(workspace.getByRole('button', { name: copy.clear })).toHaveCount(0);
      const beforeSearch = parity.network.requests.length;
      const search = workspace.getByRole('searchbox');
      await search.fill('unmatched'); await expect(workspace.getByText(copy.noResults, { exact: true })).toBeVisible();
      await workspace.getByRole('button', { name: copy.clear }).click();
      await expect(search).toBeFocused(); await expect(search).toHaveValue(''); await expect(workspace.getByRole('table')).toBeVisible();
      expect(parity.network.requests).toHaveLength(beforeSearch);
      await open(parity, { 'quotas.tenant': 'quotas-500-then-ok' });
      await surface(parity).getByRole('button', { name: copy.retry }).click(); await expect(surface(parity).getByRole('table')).toHaveCount(2);
      if (role === 'superadmin') {
        for (const variant of ['tenant-plan-none', 'tenant-plan-500-then-ready', 'tenant-plan-delayed', 'tenant-plan-delayed-then-500']) {
          await open(parity, { 'quotas.plan': variant });
          await surface(parity).getByRole('button', { name: /Maximum Workspaces/ }).first().click();
          if (variant.includes('delayed')) {
            await expect(dialog(parity).getByText(copy.resolving)).toBeVisible(); await expect(button(parity, copy.save)).toHaveCount(0); await expect(button(parity, copy.cancel)).toHaveCount(0);
          }
          if (variant.endsWith('none')) await expect(dialog(parity).getByRole('link', { name: copy.assignPlan })).toHaveAttribute('href', '/console/tenants/synthetic-tenant/plan');
          else if (variant.includes('500')) {
            await expect(dialog(parity).getByText(copy.planError, { exact: true })).toBeVisible();
            if (variant.endsWith('ready')) { await button(parity, copy.retry).click(); await expect(dialog(parity).getByRole('spinbutton')).toBeFocused(); }
          } else await expect(dialog(parity).getByRole('spinbutton')).toBeFocused();
          await parity.page.keyboard.press('Escape'); await expect(dialog(parity)).toHaveCount(0);
        }
        for (const variant of ['plan-limit-put-invalid', 'plan-limit-put-frozen', 'plan-limit-put-403', 'plan-limit-put-404']) {
          await open(parity, { 'quotas.put': variant }); await review(parity, copy); await button(parity, copy.confirm).click();
          await expect(dialog(parity).getByText(copy.saveError, { exact: true })).toBeVisible(); await expect(dialog(parity).getByRole('spinbutton')).toHaveValue('500');
          await button(parity, copy.cancel).click();
        }
        await open(parity); await adjust(parity);
        for (const value of ['-2', '1.5']) {
          const before = puts(parity).length; await dialog(parity).getByRole('spinbutton').fill(value); await button(parity, copy.save).click();
          await expect(dialog(parity).getByText(copy.invalid)).toBeVisible(); await expect(dialog(parity).getByRole('spinbutton')).toBeFocused(); expect(puts(parity)).toHaveLength(before);
        }
        await parity.page.keyboard.press('Escape');
      }
      const before = parity.network.requests.length;
      await open(parity, { 'quotas.tenant': 'quotas-401', refresh: '401' });
      await expect(parity.page).toHaveURL(/\/login$/);
      expect(parity.network.requests.slice(before).filter((request) => request.method === 'POST')).toHaveLength(1);
      expect(await parity.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(new URL(server.url('console/quotas')).pathname);
      allowlist(parity);
    });
    test('accessibility', async ({ parity }) => {
      await open(parity); await check.assertAccessibility(parity); await check.assertLocale(parity);
      if (role === 'superadmin') {
        const trigger = surface(parity).getByRole('button', { name: /Maximum Workspaces/ }).first();
        await keyboardActivate(parity.page, trigger); await expect(dialog(parity).getByRole('spinbutton')).toBeFocused();
        await check.assertAccessibility(parity); await check.assertLocale(parity);
        await button(parity, copy.save).click(); const before = puts(parity).length;
        await parity.page.keyboard.press('Escape'); await expect(dialog(parity)).toHaveCount(0); await expect(trigger).toBeFocused(); expect(puts(parity)).toHaveLength(before);
        await trigger.click(); await expect(dialog(parity).getByRole('spinbutton')).toBeFocused();
        // Fullscreen mobile has no outside surface; desktop uses the viewport backdrop.
        if (width >= 768) { await parity.page.mouse.click(1, 1); await expect(dialog(parity)).toHaveCount(0); await expect(trigger).toBeFocused(); }
        else await button(parity, copy.cancel).click();
      }
    });
    test('runtime-health', async ({ parity, server }) => {
      for (const method of ['link', 'navigate']) {
        await parity.open('/console/__fixture/quotas-link');
        const target = method === 'link' ? parity.page.locator('main a[href$="/console/quotas"]').last() : parity.page.locator('main section button').last();
        await target.click(); await expect(surface(parity).getByRole('table')).toHaveCount(2); await check.assertRuntimeHealth(parity);
      }
      await open(parity); await check.assertRuntimeHealth(parity);
      await withRole(parity, server, ['platform_operator']); await expect(surface(parity).locator('button[data-quota-adjust-trigger]')).toHaveCount(9);
      await withRole(parity, server, ['member']); await expect(surface(parity).getByRole('columnheader', { name: copy.action, exact: true })).toHaveCount(0);
      await check.assertRuntimeHealth(parity); allowlist(parity);
    });
    test('responsive', async ({ parity }) => {
      await open(parity); await check.assertResponsive(parity, width);
      if (role === 'superadmin') { await adjust(parity); await assertDialogResponsive(parity, width); await button(parity, copy.save).click(); await assertDialogResponsive(parity, width); }
    });
    test('visual-review', async ({ parity, server }, info) => {
      async function capture(name) {
        const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
        await info.attach(`${name}-${locale}-${width}-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
      }
      for (const variant of ['success', 'empty', '404', '500']) { await open(parity, { 'quotas.tenant': variant }); await capture(variant); }
      await open(parity, { 'quotas.workspace': 'empty' }); await capture('empty-workspace');
      await open(parity, { 'quotas.tenantOverview': 'healthy' }); await capture('healthy-posture');
      await open(parity, { 'quotas.tenantOverview': 'hard_limit_reached' }); await capture('hard-limit-reached-posture');
      await open(parity, { tenants: 'empty' }); await capture('blocked');
      await open(parity); await capture(role);
      await withRole(parity, server, ['member']); await capture('plain-member');
      await withRole(parity, server, ['platform_operator']); await capture('platform-operator');
      if (role !== 'superadmin') return;
      for (const variant of ['tenant-plan-delayed', 'tenant-plan-none', 'tenant-plan-frozen', 'tenant-plan-500']) {
        await open(parity, { 'quotas.plan': variant });
        await surface(parity).getByRole('button', { name: /Maximum Workspaces/ }).first().click();
        if (variant.endsWith('delayed')) { await expect(dialog(parity).getByText(copy.resolving)).toBeVisible(); await capture('resolving'); await expect(dialog(parity).getByRole('spinbutton')).toBeFocused(); await capture('ready'); }
        else { await expect(button(parity, copy.close)).toBeVisible(); await capture(variant); }
      }
      for (const [variant, value] of [['plan-limit-put-slow', '500'], ['plan-limit-put-unlimited-ok', '-1'], ['plan-limit-put-slow-500', '500']]) {
        await open(parity, { 'quotas.put': variant }); await review(parity, copy, value); await capture('confirm'); await button(parity, copy.confirm).click();
        if (variant.includes('slow')) { await expect(button(parity, copy.saving)).toBeVisible(); await capture('saving'); }
        await expect(button(parity, variant.endsWith('500') ? copy.cancel : copy.close)).toBeEnabled(); await capture(variant);
      }
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
  });
}
