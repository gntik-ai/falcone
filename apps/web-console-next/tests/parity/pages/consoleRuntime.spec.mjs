import { createHash } from 'node:crypto';
import manifest, { runtimePath, ready } from './consoleRuntime.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import es from '../../../src/locales/es/pages.console-runtime-page.json' with { type: 'json' };
import en from '../../../src/locales/en/pages.console-runtime-page.json' with { type: 'json' };

const copy = (parity) => parity.locale === 'es' ? es : en;
const runtimeRequests = (parity) => parity.network.requests.filter((request) => request.path === runtimePath);
const button = (parity, key) => parity.page.getByRole('button', { name: copy(parity)[key], exact: true });
const tab = (parity, key) => parity.page.getByRole('tab', { name: copy(parity)[key], exact: true });
const status = (parity, state) => parity.page.getByLabel(copy(parity).statusName.replace('{state}', copy(parity).state[state]), { exact: true });
const observers = ['superadmin', 'platform_admin', 'platform_operator', 'platform_auditor'];
const stateCases = [
  ['knative-ready', 'ready', 'managed'], ['knative-degraded', 'degraded', 'managed'],
  ['knative-unverified', 'unverified', 'managed'], ['knative-disabled', 'disabled', 'disabled'],
  ['knative-unavailable-external', 'unavailable', 'external'], ['knative-unknown-values', 'unknown', 'unknown'],
];
async function settled(parity) {
  await expect(parity.page.locator('.console-runtime')).toBeVisible();
  await expect(parity.page.locator('.console-runtime [aria-busy="true"]')).toHaveCount(0);
  await parity.page.evaluate(() => document.fonts.ready);
}
async function snapshot(parity, info, name) {
  await check.assertLocale(parity);
  const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
  const sha256 = createHash('sha256').update(body).digest('hex');
  await info.attach(`${name}-${parity.locale}-sha256-${sha256}`, { body, contentType: 'image/png' });
}
// Model the legacy document boundary; application exit hrefs must remain absolute legacy paths.
async function exitToLegacy(parity, path, linkName) {
  const session = await parity.page.evaluate(() => sessionStorage.getItem('in-falcone.console-shell-session'));
  const match = (url) => url.pathname === path;
  await parity.page.route(match, async (route) => {
    await route.fulfill({ contentType: 'text/html', body: `<html lang="${parity.locale}"><head><title>${copy(parity).consoleTitle}</title></head><body><main><h1>${linkName}</h1></main></body></html>` });
  });
  await parity.page.getByRole('link', { name: linkName, exact: true }).click();
  await expect(parity.page).toHaveURL(new RegExp(`${path}$`));
  expect(await parity.page.evaluate(() => sessionStorage.getItem('in-falcone.console-shell-session'))).toBe(session);
  await expect(parity.page).toHaveTitle(copy(parity).consoleTitle);
  await check.assertRuntimeHealth(parity);
  await parity.page.unroute(match);
}

for (const role of observers) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`consoleRuntime | ${role} | ${locale} | ${width}`, () => {
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test.beforeEach(async ({ parity, server }) => {
      parity.open = async (route, variants = {}) => {
        parity.network.setVariants(variants);
        await parity.page.goto(server.url(route.replace(/^\//, '')));
        await settled(parity);
      };
    });
    test('data', async ({ parity }) => {
      await check.data(parity, manifest);
      await expect(parity.page.locator('main dt')).toHaveText(Object.values(copy(parity).fields));
      const transition = new Date(ready.lastTransitionAt);
      const expectedDate = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' }).format(transition);
      await expect(parity.page.locator('dd time')).toContainText(expectedDate);
      for (const [fixture, state, mode] of stateCases) {
        await parity.open(manifest.route, { runtime: fixture });
        await expect(status(parity, state)).toBeVisible();
        const tone = state === 'ready' ? 'success' : ['degraded', 'unavailable'].includes(state) ? 'warning' : 'muted';
        await expect(status(parity, state)).toHaveClass(new RegExp(`bg-${tone}`));
        await expect(parity.page.locator('dd').first()).toHaveText(copy(parity).mode[mode]);
        const dependencyState = state === 'ready' ? copy(parity).available : copy(parity).state[state];
        await expect(parity.page.getByText(copy(parity).dependencyDescription.replace('{state}', dependencyState), { exact: true })).toHaveCount(2);
        const actionable = ['degraded', 'unavailable'].includes(state);
        await expect(parity.page.getByText(copy(parity).unavailableNote, { exact: true })).toHaveCount(actionable ? 1 : 0);
        await expect(parity.page.getByText(copy(parity).advisory, { exact: true })).toHaveCount(actionable ? 1 : 0);
        await expect(parity.page.getByText(copy(parity).disabledNote, { exact: true })).toHaveCount(mode === 'disabled' ? 1 : 0);
        await expect(parity.page.getByText(copy(parity).unverifiedNote, { exact: true })).toHaveCount(state === 'unverified' ? 1 : 0);
        await expect(parity.page.getByText('WEBHOOK_NOT_READY', { exact: true })).toHaveCount(0);
        if (state === 'unknown') {
          await expect(parity.page.getByText(copy(parity).missingOwner, { exact: true })).toBeVisible();
          await expect(parity.page.getByText(copy(parity).missingVersion, { exact: true })).toBeVisible();
        }
        await expect(parity.page.locator('.console-runtime').getByRole('button')).toHaveCount(1);
        await expect(button(parity, 'recheck')).toBeVisible();
        const announcement = state === 'unknown' ? copy(parity).unknownAnnouncement : copy(parity).state[state];
        await expect(parity.page.locator('[aria-live="polite"]').filter({ hasText: copy(parity).updated.replace('{state}', announcement) })).toHaveCount(1);
        const start = runtimeRequests(parity).length;
        await tab(parity, 'history').click();
        await expect(parity.page.getByRole('list', { name: copy(parity).history }).locator('li')).toHaveCount(1);
        await expect(parity.page.getByRole('list', { name: copy(parity).history }).getByText(copy(parity).state[state], { exact: true })).toBeVisible();
        expect(runtimeRequests(parity)).toHaveLength(start);
      }
    });
    test('action', async ({ parity }) => {
      await parity.open(manifest.route);
      expect(runtimeRequests(parity)).toEqual([{ method: 'GET', path: runtimePath, body: undefined }]);
      for (let count = 2; count <= 3; count++) {
        await button(parity, 'recheck').click();
        await expect(button(parity, 'recheck')).toBeEnabled();
        expect(runtimeRequests(parity)).toHaveLength(count);
        await expect(button(parity, 'recheck')).toBeFocused();
      }
      await parity.open(manifest.route, { runtime: 'knative-500-then-ready' });
      const start = runtimeRequests(parity).length;
      await button(parity, 'retry').click();
      await expect(button(parity, 'recheck')).toBeFocused();
      await expect(status(parity, 'ready')).toBeVisible();
      expect(runtimeRequests(parity)).toHaveLength(start + 1);
      await tab(parity, 'history').click();
      await expect(parity.page.getByRole('list', { name: copy(parity).history }).locator('li')).toHaveCount(1);
      expect(runtimeRequests(parity)).toHaveLength(start + 1);
      await parity.open(manifest.route, { runtime: 'knative-500' });
      await button(parity, 'retry').click();
      await expect(button(parity, 'retry')).toBeFocused();
      await expect(parity.page.getByText('synthetic-runtime-request', { exact: true })).toBeVisible();
    });
    test('error-empty', async ({ parity, server }) => {
      await check.errorEmpty(parity, manifest);
      for (const [fixture, heading] of [['knative-403', 'noAccess'], ['knative-404', 'notFound']]) {
        await parity.open(manifest.route, { runtime: fixture });
        await expect(parity.page.getByRole('heading', { name: copy(parity)[heading], exact: true })).toBeVisible();
        await expect(parity.page.getByRole('link', { name: copy(parity).back })).toHaveAttribute('href', '/console/overview');
        await expect(button(parity, 'retry')).toHaveCount(0);
      }
      await parity.open(manifest.route, { runtime: 'knative-no-transition' });
      await tab(parity, 'history').click();
      await expect(parity.page.getByRole('heading', { name: copy(parity).missingTransition, exact: true })).toBeVisible();
      await expect(parity.page.getByRole('list', { name: copy(parity).history })).toHaveCount(0);
      await parity.open(manifest.route, { runtime: 'knative-disabled' });
      await expect(parity.page.getByText(copy(parity).disabledNote, { exact: true })).toBeVisible();
      await expect(parity.page.getByRole('heading', { name: copy(parity).missingTransition, exact: true })).toHaveCount(0);
      // Hold the registered response so the skeleton assertion is independent of CI timing.
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      const hold = async (route) => { await held; await route.fallback(); };
      await parity.page.route(`**${runtimePath}`, hold);
      try {
        parity.network.setVariants({ runtime: 'knative-delayed' });
        await parity.page.goto(server.url('console/runtime'));
        await expect(parity.page.getByText(copy(parity).loading, { exact: true })).toHaveCount(1);
        await expect(parity.page.getByText(copy(parity).loadingNote, { exact: true })).toBeVisible();
      } finally { release(); await parity.page.unroute(`**${runtimePath}`, hold); }
      await settled(parity);
      parity.network.setVariants({ runtime: 'knative-network' });
      await button(parity, 'recheck').click();
      await expect(button(parity, 'retry')).toBeVisible();
      await expect(status(parity, 'ready')).toHaveCount(0);
      await expect(parity.page.getByText('platform', { exact: true })).toHaveCount(0);
    });
    test('accessibility', async ({ parity }) => {
      for (const variant of ['knative-ready', 'knative-500', 'knative-500-then-ready']) {
        await parity.open(manifest.route, { runtime: variant });
        await check.assertAccessibility(parity);
        await check.assertLocale(parity);
        await expect(parity.page).toHaveTitle(copy(parity).documentTitle);
        if (variant === 'knative-500-then-ready') {
          await button(parity, 'retry').click();
          await expect(button(parity, 'recheck')).toBeFocused();
          await check.assertAccessibility(parity);
        }
      }
      await parity.open(manifest.route);
      await tab(parity, 'overview').focus();
      await parity.page.keyboard.press('ArrowRight');
      await parity.page.keyboard.press('Enter');
      await expect(tab(parity, 'history')).toHaveAttribute('aria-selected', 'true');
      await parity.page.keyboard.press('ArrowLeft');
      await parity.page.keyboard.press('Enter');
      await expect(tab(parity, 'overview')).toHaveAttribute('aria-selected', 'true');
      await parity.page.keyboard.press('Tab');
      await expect(button(parity, 'recheck')).toBeFocused();
      for (const key of ['inspectFunctions', 'inspectHostedMcp']) {
        await parity.page.keyboard.press('Tab');
        await expect(parity.page.getByRole('link', { name: copy(parity)[key] })).toBeFocused();
      }
    });
    test('runtime-health', async ({ parity, server }) => {
      await parity.open(manifest.route);
      await check.assertRuntimeHealth(parity);
      // Entry through the shell's real migrated client link, including the mobile drawer.
      await parity.page.goto(server.url('console/overview'));
      await expect(parity.page.getByRole('heading', { name: locale === 'es' ? 'Resumen' : 'Overview', exact: true })).toBeVisible();
      if (width < 1024) await parity.page.getByRole('button', { name: locale === 'es' ? 'Abrir navegación' : 'Open navigation', exact: true }).click();
      const navigation = width < 1024 ? parity.page.getByRole('dialog') : parity.page.locator('aside');
      await navigation.getByRole('link', { name: copy(parity).title, exact: true }).click();
      await settled(parity);
      await check.assertRuntimeHealth(parity);
      for (const [fixture, path, name] of [
        ['knative-ready', '/console/functions', 'inspectFunctions'], ['knative-ready', '/console', 'inspectHostedMcp'],
        ['knative-403', '/console/overview', 'back'], ['knative-404', '/console/overview', 'back'],
      ]) {
        await parity.open(manifest.route, { runtime: fixture });
        await expect(parity.page.getByRole('link', { name: copy(parity)[name] })).toHaveAttribute('href', path);
        await exitToLegacy(parity, path, copy(parity)[name]);
      }
    });
    test('responsive', async ({ parity }) => {
      await parity.open(manifest.route);
      await check.assertResponsive(parity, width);
      await parity.page.route(`**${runtimePath}`, async (route) => route.fulfill({ json: { ...ready, owner: 'synthetic-owner-'.repeat(30), version: 'synthetic-version-'.repeat(30) } }));
      await parity.page.reload();
      await settled(parity);
      await check.assertResponsive(parity, width);
      await tab(parity, 'history').click();
      await check.assertResponsive(parity, width);
    });
    test('visual-review', async ({ parity }, info) => {
      // Artifacts require the checker's visual assessment and operator approval.
      for (const fixture of [...stateCases.map(([fixture]) => fixture), 'knative-no-transition', 'knative-403', 'knative-404', 'knative-500']) {
        await parity.open(manifest.route, { runtime: fixture });
        await snapshot(parity, info, fixture);
        if (['knative-ready', 'knative-no-transition'].includes(fixture)) {
          await tab(parity, 'history').click();
          await snapshot(parity, info, `${fixture}-history`);
        }
      }
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
  });
}

for (const role of ['member', 'tenant_admin', 'tenant_owner']) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`consoleRuntime denied (${role}, ${locale}, ${width})`, () => {
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test('observer guard denies without a runtime request', async ({ parity, server }, info) => {
      await parity.page.goto(server.url('console/runtime'));
      await expect(parity.page.getByRole('heading', { name: copy(parity).denialTitle })).toBeVisible();
      expect(runtimeRequests(parity)).toHaveLength(0);
      await snapshot(parity, info, `denied-${role}`);
    });
  });
}
for (const variant of ['knative-401', 'knative-401-refresh-ok', 'knative-401-after-refresh']) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`consoleRuntime unauthorized (${variant}, ${locale}, ${width})`, () => {
    test.use({ role: 'platform_auditor', locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test('session owns one refresh and the protected return path', async ({ parity, server }) => {
      parity.network.setVariants({ runtime: variant, refresh: variant === 'knative-401' ? '401' : 'success' });
      const url = server.url('console/runtime');
      await parity.page.goto(url);
      if (variant === 'knative-401-refresh-ok') {
        await expect(status(parity, 'ready')).toBeVisible();
        await expect(parity.page).toHaveURL(url);
      } else {
        await expect(parity.page).toHaveURL(/\/login$/);
        expect(await parity.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(new URL(url).pathname);
      }
      await expect(parity.page.getByRole('heading', { name: copy(parity).errorTitle })).toHaveCount(0);
      expect(runtimeRequests(parity)).toHaveLength(variant === 'knative-401' ? 1 : 2);
      expect(parity.network.requests.filter((request) => request.path.endsWith('/refresh'))).toHaveLength(1);
    });
  });
}
