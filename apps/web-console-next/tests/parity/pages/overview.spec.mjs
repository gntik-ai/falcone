import { createHash } from 'node:crypto';
import manifest from './overview.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import es from '../../../src/locales/es/pages.console-overview-page.json' with { type: 'json' };
import en from '../../../src/locales/en/pages.console-overview-page.json' with { type: 'json' };

const copy = (parity) => parity.locale === 'es' ? es : en;
const overview = (parity) => parity.page.locator('.console-overview');
const variants = (variant) => ({ tenants: variant, tenant: variant });
const summaries = { tenants: 'overview-summaries', tenant: 'overview-summaries' };
const quickLinks = ['workspaces', 'members', 'flows', 'my-plan'];
const errors = ['403', '404', '500', 'network'];
const emptyStates = ['overview-no-tenant', 'overview-without-summaries', 'overview-empty-quotas', 'overview-no-workspaces'];
async function attachSurface(parity, info, state, width) {
  const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
  const sha256 = createHash('sha256').update(body).digest('hex');
  await info.attach(`${state}-${parity.locale}-${width}-sha256-${sha256}`, { body, contentType: 'image/png' });
}
const flatten = (object) => Object.values(object).flatMap((value) => typeof value === 'string' ? [value] : flatten(value));
async function openWithStoredTenant(parity, server, multiple = false) {
  // Enter through client navigation after seeding storage, so the harness's
  // document bootstrap does not clear the deliberately invalid selection.
  await parity.open('/');
  parity.network.setVariants(multiple ? variants('overview-multiple-tenants') : summaries);
  await parity.page.evaluate(({ path, multiple }) => {
    if (multiple) {
      const session = JSON.parse(sessionStorage.getItem('in-falcone.console-shell-session'));
      session.principal.tenantIds = [];
      sessionStorage.setItem('in-falcone.console-shell-session', JSON.stringify(session));
    }
    localStorage.setItem('in-falcone.console-active-context', JSON.stringify({ userId: 'synthetic-user', tenantId: 'synthetic-removed', workspaceId: null, updatedAt: '2026-06-01T12:00:00Z' }));
    history.pushState(null, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
  }, { path: new URL(server.url('console/overview')).pathname, multiple });
  await expect(overview(parity).getByRole('heading', { name: copy(parity).title, exact: true, level: 1 })).toBeVisible();
  await expect(overview(parity).locator('[aria-busy="true"]')).toHaveCount(0);
}
async function assertOverviewLocale(parity) {
  // The shell's empty WorkspaceSwitcher has a known kit copy gap (manifest.states).
  // Check all overview text and accessible names independently in those states.
  await expect(parity.page.locator('html')).toHaveAttribute('lang', parity.locale);
  const values = await overview(parity).evaluate((root) => [root, ...root.querySelectorAll('*')].flatMap((element) => {
    if (!element.getClientRects().length) return [];
    return [element.textContent, ...['aria-label', 'title', 'placeholder', 'alt', 'aria-valuetext'].map((name) => element.getAttribute(name))].filter(Boolean);
  }));
  const english = flatten(en).filter((value) => !flatten(es).includes(value) && !value.includes('{'));
  expect(values.filter((value) => /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/.test(value.trim()) ||
    parity.locale === 'es' && english.includes(value.trim()))).toEqual([]);
  await expect(overview(parity)).not.toContainText(/req_8f2c41d07a9b|acme-web|Recent activity|Monthly revenue/);
}
async function toggle(parity, kind) {
  const trigger = overview(parity).getByRole('button', { name: copy(parity)[kind].disclosure, exact: true });
  await trigger.focus();
  await parity.page.keyboard.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(trigger).toBeFocused();
  return trigger;
}
async function assertNoPageRequests(parity) {
  const tenant = parity.role === 'tenant_owner'
    ? '/v1/tenants/synthetic-tenant' : '/v1/tenants?page%5Bsize%5D=100&sort=displayName';
  expect(parity.network.requests).toEqual([
    { method: 'GET', path: tenant, body: undefined },
    { method: 'GET', path: '/v1/workspaces?page%5Bsize%5D=100&sort=displayName&filter%5BtenantId%5D=synthetic-tenant', body: undefined },
  ]);
}

for (const role of manifest.roles) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`overview | ${role} | ${locale} | ${width}`, () => {
    test.use({ role, locale, viewport: { width, height: 900 } });
    test.beforeEach(async ({ parity }) => {
      const open = parity.open.bind(parity);
      parity.open = async (route, selected = {}) => {
        await open(route, { ...summaries, ...selected });
        if (route === manifest.route && !['401'].includes(selected.tenant) && !['401'].includes(selected.tenants) && !['401'].includes(selected.workspaces)) {
          await expect(overview(parity).getByRole('heading', { name: copy(parity).title, exact: true, level: 1 })).toBeVisible();
          await expect(overview(parity).locator('[aria-busy="true"]')).toHaveCount(0);
        }
      };
    });
    test('data', async ({ parity }) => {
      await check.data(parity, manifest);
      const text = copy(parity);
      for (const total of Object.values(text.quota.total)) await expect(overview(parity).getByText(total.replace('{total}', '1'), { exact: true })).toBeVisible();
      const kpis = overview(parity).locator('dl');
      await expect(kpis.locator('dt')).toHaveText(Object.values(text.inventory).slice(2, 6));
      await expect(kpis.locator('dd')).toHaveText([2, 12345, 19876, 4321].map((value) => new Intl.NumberFormat(locale).format(value)));
      await expect(kpis.locator('svg')).toHaveCount(0);
      await toggle(parity, 'quota'); await toggle(parity, 'inventory');
      await expect(overview(parity).getByRole('meter')).toHaveCount(3);
      const count = (value) => new Intl.NumberFormat(locale).format(value);
      for (const [metric, scope, severity, used, limit, remaining, utilization, unit] of [
        ['invocations_per_minute', 'workspace', 'blocked', 1000, 1000, 0, 100, 'rpm'],
        ['applications', 'tenant', 'warning', 80, 100, 20, 80, ''],
        ['workspaces', 'tenant', 'nominal', 2, 10, 8, 20, ''],
      ]) {
        const item = overview(parity).getByText(metric, { exact: true }).locator('xpath=../..');
        await expect(item.getByText(text.quota.scope.replace('{scope}', scope), { exact: true })).toBeVisible();
        await expect(item.getByText(text.quota.severity[severity], { exact: true })).toBeVisible();
        const values = { used, limit, remaining, utilization };
        const usage = text.quota.usage.replace(/\{(used|limit|remaining|utilization)\}/g, (_, key) => count(values[key]))
          .replace('{unit}', unit ? text.quota.unit.replace('{unit}', unit) : '');
        const meter = overview(parity).getByRole('meter', { name: metric, exact: true });
        await expect(meter).toHaveAttribute('aria-valuetext', usage);
        await expect(meter).toHaveAttribute('aria-valuenow', String(utilization));
        await expect(item.getByText(usage, { exact: true })).toBeVisible();
      }
      for (const [slug, applications, serviceAccounts, resources] of [
        ['workspace-prod', 12340, 4320, 19865], ['workspace-dev', 5, 1, 11],
      ]) {
        const workspace = overview(parity).getByText(slug, { exact: true }).locator('..');
        const values = { applications, serviceAccounts, resources };
        const detail = text.inventory.workspace.replace(/\{(applications|serviceAccounts|resources)\}/g, (_, key) => count(values[key]));
        await expect(workspace.getByText(detail, { exact: true })).toBeVisible();
      }
      await assertNoPageRequests(parity);
      await check.assertLocale(parity);
    });
    test('action', async ({ parity, server }) => {
      await parity.open(manifest.route);
      for (const kind of ['quota', 'inventory']) {
        const start = parity.network.requests.length;
        const trigger = await toggle(parity, kind);
        await parity.page.keyboard.press('Enter');
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
        await expect(trigger).toBeFocused();
        expect(parity.network.requests).toHaveLength(start);
      }
      for (const key of quickLinks) {
        await parity.open(manifest.route);
        const link = overview(parity).getByRole('link', { name: copy(parity).quick[key].label, exact: true });
        await expect(link).toHaveAttribute('href', `/console/${key}`);
        // The destination is a legacy full load. Fulfil its document locally.
        const target = new URL(`/console/${key}`, server.origin).href;
        await parity.page.route(target, (route) => route.fulfill({ contentType: 'text/html', body: '<main>synthetic-legacy-destination</main>' }));
        await link.focus(); await parity.page.keyboard.press('Enter');
        await expect(parity.page).toHaveURL(target);
        await parity.page.unroute(target);
      }
      if (role === 'tenant_owner') await parity.open(manifest.route, variants('overview-no-tenant'));
      else await openWithStoredTenant(parity, server, true);
      await overview(parity).getByRole('button', { name: copy(parity).empty.tenant.action }).click();
      const switcher = parity.page.getByRole('combobox', { name: locale === 'es' ? 'Organización activa' : 'Active tenant', exact: true });
      await expect(switcher).toBeFocused();
      await parity.page.keyboard.press('Escape');
      if (role !== 'tenant_owner') {
        await switcher.selectOption('synthetic-tenant');
        await expect(overview(parity).getByTestId('console-tenant-inventory-summary')).toBeVisible();
      }
      // Mirror the legacy authenticated shell journey, including session termination.
      await check.action(parity, manifest);
    });
    test('error-empty', async ({ parity, server }, info) => {
      await check.errorEmpty(parity, manifest);
      for (const variant of emptyStates) {
        await parity.open(manifest.route, variants(variant));
        const text = copy(parity);
        if (variant === 'overview-no-tenant') await expect(overview(parity).getByRole('heading', { name: text.empty.tenant.title })).toBeVisible();
        if (variant === 'overview-without-summaries') for (const kind of ['quota', 'inventory']) await expect(overview(parity).getByRole('heading', { name: text.empty[kind].title })).toBeVisible();
        if (variant === 'overview-empty-quotas') await expect(overview(parity).getByText(text.empty.quotaItems.description, { exact: true })).toBeVisible();
        if (variant === 'overview-no-workspaces') await expect(overview(parity).getByRole('button', { name: text.inventory.disclosure })).toHaveCount(0);
        await expect(overview(parity).getByRole('link')).toHaveCount(4);
        await check.assertAccessibility(parity);
        await assertOverviewLocale(parity);
      }
      for (const variant of errors) {
        await parity.open(manifest.route, variants(variant));
        await expect(overview(parity).getByRole('heading', { name: variant === '403' ? copy(parity).noAccess.title : copy(parity).error.title, exact: true })).toBeVisible();
        await expect(overview(parity).getByTestId('console-tenant-quota-summary')).toHaveCount(0);
        await expect(overview(parity).getByTestId('console-tenant-inventory-summary')).toHaveCount(0);
        await expect(overview(parity).getByRole('button')).toHaveCount(0);
        await expect(overview(parity).getByRole('link')).toHaveCount(4);
        await check.assertAccessibility(parity);
        await check.assertResponsive(parity, width);
        await assertOverviewLocale(parity);
        if (variant === '500') await attachSurface(parity, info, 'error', width);
      }
      // Hold the shell bootstrap response so both named loading states are observable.
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      const hold = async (route) => { await held; await route.fallback(); };
      await parity.page.route('**/v1/tenants**', hold);
      try {
        parity.network.setVariants(summaries);
        await parity.page.goto(server.url('console/overview'));
        for (const label of Object.values(copy(parity).loading)) await expect(overview(parity).getByRole('status', { name: label })).toBeVisible();
        await expect(overview(parity).getByRole('link')).toHaveCount(4);
        await check.assertAccessibility(parity);
      } finally { release(); await parity.page.unroute('**/v1/tenants**', hold); }
      await expect(overview(parity).getByTestId('console-tenant-inventory-summary')).toBeVisible();
      // Stored tenant fallback is owned by the shell, never inferred by this page.
      await openWithStoredTenant(parity, server);
      await expect(overview(parity).getByTestId('console-tenant-inventory-summary')).toBeVisible();
      if (role !== 'tenant_owner') {
        await openWithStoredTenant(parity, server, true);
        await expect(overview(parity).getByRole('heading', { name: copy(parity).empty.tenant.title })).toBeVisible();
        await check.assertAccessibility(parity);
        await assertOverviewLocale(parity);
        const switcher = parity.page.getByRole('combobox', { name: locale === 'es' ? 'Organización activa' : 'Active tenant', exact: true });
        await switcher.selectOption('synthetic-tenant');
        await expect(overview(parity).getByTestId('console-tenant-inventory-summary')).toBeVisible();
        let releaseSwitch;
        const switching = new Promise((resolve) => { releaseSwitch = resolve; });
        const holdSwitch = async (route) => { await switching; await route.fallback(); };
        await parity.page.route('**/v1/workspaces?**', holdSwitch);
        parity.network.setVariants({ ...variants('overview-multiple-tenants'), workspaces: '500' });
        try {
          await switcher.selectOption('synthetic-tenant-other');
          for (const label of Object.values(copy(parity).loading)) await expect(overview(parity).getByRole('status', { name: label })).toBeVisible();
          for (const kind of ['quota', 'inventory']) await expect(overview(parity).getByTestId(`console-tenant-${kind}-summary`)).toHaveCount(0);
        } finally { releaseSwitch(); await parity.page.unroute('**/v1/workspaces?**', holdSwitch); }
        await expect(overview(parity).getByRole('heading', { name: copy(parity).error.title, exact: true })).toBeVisible();
        for (const kind of ['quota', 'inventory']) await expect(overview(parity).getByTestId(`console-tenant-${kind}-summary`)).toHaveCount(0);
        await expect(overview(parity).getByRole('link')).toHaveCount(4);
        await check.assertAccessibility(parity);
        await assertOverviewLocale(parity);
      }
      const start = parity.network.requests.length;
      await parity.open(manifest.route, variants('401'));
      await expect(parity.page).toHaveURL(/\/login$/);
      await check.assertAccessibility(parity);
      expect(parity.network.requests.slice(start).filter((request) => request.path.endsWith('/refresh'))).toEqual([
        { method: 'POST', path: '/v1/auth/login-sessions/synthetic-session/refresh', body: { refreshToken: 'synthetic-refresh-token' } },
      ]);
      await expect.poll(() => parity.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe('/console/overview');
    });
    test('accessibility', async ({ parity }) => {
      await parity.open(manifest.route);
      for (const link of await overview(parity).getByRole('link').all()) {
        await expect(link.locator('xpath=ancestor::div[contains(@class,"group/card")]').locator('a, button, [tabindex="0"]')).toHaveCount(1);
      }
      for (const kind of ['quota', 'inventory']) {
        const trigger = await toggle(parity, kind);
        await parity.page.keyboard.press('Enter');
        await expect(trigger).toBeFocused();
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
        await toggle(parity, kind);
      }
      await check.assertAccessibility(parity); await check.assertLocale(parity);
      // Error fixtures remain in error-empty; this check covers the success and empty surfaces.
      for (const variant of emptyStates) {
        await parity.open(manifest.route, variants(variant));
        await check.assertAccessibility(parity);
      }
    });
    test('runtime-health', async ({ parity }) => {
      await parity.open('/console');
      if (role === 'tenant_viewer') await expect(parity.page).toHaveURL(/\/console\/observability$/);
      else await expect(parity.page).toHaveURL(/\/console\/overview$/);
      await check.assertRuntimeHealth(parity);
      await parity.open(manifest.route);
      await check.assertRuntimeHealth(parity);
      await parity.open('/console/settings');
      const nav = parity.page.getByRole('navigation', { name: locale === 'es' ? 'Navegación de consola' : 'Console navigation', exact: true }).first();
      if (!await nav.isVisible()) await parity.page.getByRole('button', { name: locale === 'es' ? 'Abrir navegación' : 'Open navigation', exact: true }).click();
      await parity.page.getByRole('link', { name: locale === 'es' ? 'Vista general' : 'Overview', exact: true }).filter({ visible: true }).first().click();
      await expect(overview(parity)).toBeVisible();
      await check.assertRuntimeHealth(parity);
    });
    test('responsive', async ({ parity }) => {
      for (const variant of ['overview-summaries', ...emptyStates]) {
        await parity.open(manifest.route, variants(variant));
        if (variant === 'overview-summaries') { await toggle(parity, 'quota'); await toggle(parity, 'inventory'); }
        await check.assertResponsive(parity, width);
        const columns = await overview(parity).locator('#overview-quick').evaluate((heading) => getComputedStyle(heading.closest('section').querySelector('.grid')).gridTemplateColumns.split(' ').length);
        expect(columns).toBe(width === 375 ? 1 : 2);
        if (variant === 'overview-summaries') expect(await overview(parity).locator('dl').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(width === 375 ? 1 : width === 768 ? 2 : 4);
      }
    });
    test('visual-review', async ({ parity }, info) => {
      // The fourth review surface is attached by error-empty to keep error
      // fixtures out of the success suites and runtime-health assertions.
      for (const [state, variant] of [['populated', 'overview-summaries'], ['no-tenant', 'overview-no-tenant'], ['without-summaries', 'overview-without-summaries']]) {
        await parity.open(manifest.route, variants(variant));
        if (state === 'populated') { await toggle(parity, 'quota'); await toggle(parity, 'inventory'); }
        await assertOverviewLocale(parity);
        await attachSurface(parity, info, state, width);
      }
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
  });
}
