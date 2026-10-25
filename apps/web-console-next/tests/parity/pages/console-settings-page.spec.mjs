import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest from './console-settings-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';

const build = JSON.parse(readFileSync(new URL('../../../dist/.vite/manifest.json', import.meta.url), 'utf8'));
const copy = (locale, es, en) => locale === 'es' ? es : en;
const title = (locale) => copy(locale, 'Ajustes de consola', 'Console settings');
const select = (page, locale) => page.getByRole('combobox', { name: copy(locale, 'Idioma de la interfaz', 'Interface language'), exact: true });
const retry = (page, locale) => page.getByRole('button', { name: copy(locale, 'Reintentar', 'Retry'), exact: true });
const rawBundle = (locale) => `**/${build[`src/locales/${locale}/pages.console-settings-page.json?raw`].file}`;
const retryBundle = (locale) => `**/${build[`src/locales/${locale}/pages.console-settings-page.json`].file}`;
async function choose(page, from, to, control) {
  if (control === 'menu') {
    await page.getByRole('button', { name: copy(from, 'Menú de usuario', 'User menu'), exact: true }).click();
    await page.getByRole('combobox', { name: copy(from, 'Idioma', 'Language'), exact: true }).selectOption(to);
  } else {
    await select(page, from).click();
    await page.getByRole('listbox').getByRole('option', { name: to === 'es' ? copy(from, 'Español', 'Spanish') : copy(from, 'Inglés', 'English'), exact: true }).click();
    await expect(page.locator('[role="listbox"]')).toHaveCount(0);
  }
}
async function assertPreference(page, locale) {
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.getByRole('heading', { name: title(locale), level: 1 })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('falcone-next-locale'))).toBe(locale);
}
async function failure(parity, control, recover = true) {
  const { page, locale } = parity, target = locale === 'es' ? 'en' : 'es';
  await parity.open(manifest.route);
  const failBundle = (route) => route.fulfill({ status: 500, body: 'synthetic bundle failure' });
  await page.route(rawBundle(target), failBundle);
  try {
    await choose(page, locale, target, control);
    if (control === 'menu') await page.keyboard.press('Escape');
    await expect(retry(page, locale)).toBeVisible();
    await assertPreference(page, locale);
    // The shell and page each own an announcer; the message must reach one of them.
    await expect(page.locator('[data-live-announcer="assertive"]')).toContainText([copy(locale, 'Se mantiene el idioma anterior.', 'The previous language remains active.')]);
    if (recover) {
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      let retryRequests = 0;
      const hold = async (route) => { retryRequests++; await held; await route.fallback(); };
      await page.route(retryBundle(target), hold);
      try {
        await retry(page, locale).focus();
        await retry(page, locale).click();
        await expect.poll(() => retryRequests).toBe(1);
        await expect(select(page, locale)).toHaveAttribute('aria-busy', 'true');
        await expect(select(page, locale)).toBeDisabled();
        await expect(page.getByRole('button', { name: copy(locale, 'Reintentando…', 'Retrying…'), exact: true })).toBeFocused();
        await assertPreference(page, locale);
        release();
        await assertPreference(page, target);
        await expect(select(page, target)).toBeFocused();
      } finally {
        release();
        await page.unroute(retryBundle(target), hold);
      }
    }
  } finally { await page.unroute(rawBundle(target), failBundle); }
}

for (const role of manifest.roles) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-settings-page | ${role} | ${locale} | ${width}`, () => {
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test('data', async ({ parity }) => {
      await check.data(parity, manifest);
      await expect(select(parity.page, locale)).toHaveText(copy(locale, 'Español', 'English'));
      if (width === 1280) {
        await expect(parity.page.getByRole('navigation', { name: copy(locale, 'Ajustes de cuenta', 'Account settings') }).getByRole('link', { name: copy(locale, 'Ajustes', 'Settings'), exact: true })).toHaveAttribute('aria-current', 'page');
        await expect(parity.page.getByRole('link', { name: copy(locale, 'Perfil', 'Profile'), exact: true })).toHaveAttribute('href', '/console/profile');
      }
      await parity.open(manifest.route, { tenants: 'empty', tenant: 'empty' });
      await expect(parity.page.getByText(copy(locale, 'Preferencias operativas para tu cuenta y para la organización activa.', 'Operational preferences for your account and for the active organization.'), { exact: true })).toBeVisible();
    });
    test.describe('persisted preference', () => {
      test.use({ preserveLocale: true });
      test('action', async ({ parity }) => {
      await parity.open(manifest.route);
      const start = parity.network.requests.length;
      const target = locale === 'es' ? 'en' : 'es';
      await choose(parity.page, locale, target, 'page');
      await assertPreference(parity.page, target);
      await expect(parity.page.locator('[data-live-announcer="polite"]')).toContainText([copy(target, 'Idioma de la interfaz cambiado', 'Interface language changed')]);
      await expect(select(parity.page, target)).toBeFocused();
      await parity.page.reload();
      await assertPreference(parity.page, target);
      await choose(parity.page, target, locale, 'menu');
      await parity.page.keyboard.press('Escape');
      await assertPreference(parity.page, locale);
      expect(parity.network.requests.slice(start).filter((request) => !/\/v1\/(tenants|workspaces)/.test(request.path))).toEqual([]);
    });
    });
    test('error-empty', async ({ parity, server }) => {
      await check.errorEmpty(parity, manifest);
      await parity.open(manifest.route, { tenants: '403', tenant: '403' });
      await expect(parity.page.getByText(copy(locale, 'Preferencias operativas para tu cuenta y para la organización activa.', 'Operational preferences for your account and for the active organization.'), { exact: true })).toBeVisible();
      await expect(select(parity.page, locale)).toBeEnabled();
      await parity.page.goto(server.url('console/settings/desconocido'));
      await expect(parity.page.getByRole('heading', { name: copy(locale, 'Sección de consola no encontrada', 'Console section not found'), level: 1 })).toBeVisible();
      for (const control of ['page', 'menu']) await failure(parity, control);
      // A held shell response exposes the tenant-label skeleton deterministically.
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      const hold = async (route) => { await held; await route.fallback(); };
      await parity.page.route('**/v1/tenants**', hold);
      try {
        await parity.page.goto(server.url('console/settings'));
        await expect(parity.page.getByRole('status', { name: copy(locale, 'Cargando la organización activa.', 'Loading the active organization.') })).toBeVisible();
      } finally { release(); await parity.page.unroute('**/v1/tenants**', hold); }
    });
    test('accessibility', async ({ parity }) => {
      await check.accessibility(parity, manifest);
      const trigger = select(parity.page, locale);
      for (const key of ['Enter', ' ']) {
        await trigger.focus();
        await trigger.press(key);
        await expect(parity.page.getByRole('listbox')).toBeVisible();
        await parity.page.keyboard.press('ArrowDown');
        await parity.page.keyboard.press('Escape');
        await expect(trigger).toBeFocused();
      }
      for (const control of ['page', 'menu']) await failure(parity, control);
    });
    test('runtime-health', async ({ parity }) => {
      await parity.open(manifest.route);
      const target = locale === 'es' ? 'en' : 'es';
      await choose(parity.page, locale, target, 'page');
      await assertPreference(parity.page, target);
      await parity.page.reload();
      await check.assertRuntimeHealth(parity);
    });
    test('responsive', async ({ parity }) => {
      await parity.open(manifest.route);
      await check.assertResponsive(parity, width);
      await failure(parity, 'page', false);
      await check.assertResponsive(parity, width);
    });
    test('visual-review', async ({ parity }, info) => {
      for (const state of ['empty', 'bundle-error']) {
        if (state === 'empty') await parity.open(manifest.route);
        else await failure(parity, 'page', false);
        await check.assertLocale(parity);
        const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
        const hash = createHash('sha256').update(body).digest('hex');
        await info.attach(`${state}-${locale}-${width}-sha256-${hash}`, { body, contentType: 'image/png' });
      }
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
  });
  test.describe(`console-settings-page loading and recovery (${role}, ${locale}, ${width})`, () => {
    test.use({ role, locale, viewport: { width, height: 900 } });
    for (const control of ['page', 'menu']) test(`delayed bundle through ${control}`, async ({ parity }) => {
      const target = locale === 'es' ? 'en' : 'es';
      await parity.open(manifest.route);
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      await parity.page.route(rawBundle(target), async (route) => { await held; await route.fallback(); });
      try {
        await choose(parity.page, locale, target, control);
        if (control === 'menu') await parity.page.keyboard.press('Escape');
        await expect(select(parity.page, locale)).toHaveAttribute('aria-busy', 'true');
        await expect(select(parity.page, locale)).toBeDisabled();
        await assertPreference(parity.page, locale);
      } finally { release(); }
      await assertPreference(parity.page, target);
    });
    test('render error reference and remount', async ({ parity, server }) => {
      await parity.page.addInitScript(() => {
        window.__settingsRenderFailure = true;
        const find = Array.prototype.find;
        Array.prototype.find = function (predicate, ...args) {
          if (window.__settingsRenderFailure && this[0]?.tenantId && String(predicate).includes('.activeTenantId')) throw new Error('synthetic settings render failure');
          return find.call(this, predicate, ...args);
        };
      });
      await parity.page.goto(server.url('console/settings'));
      await expect(parity.page.getByRole('heading', { name: title(locale), level: 1 })).toBeVisible();
      await expect(parity.page.getByText(copy(locale, 'Referencia del error', 'Error reference'), { exact: true })).toBeVisible();
      await expect(parity.page.locator('code').filter({ hasText: /^client-.+/ })).toBeVisible();
      await parity.page.evaluate(() => { window.__settingsRenderFailure = false; });
      await retry(parity.page, locale).click();
      await expect(select(parity.page, locale)).toBeEnabled();
    });
    test('401 refresh once and login redirect', async ({ parity, server }) => {
      parity.network.setVariants({ tenants: '401', tenant: '401', refresh: '401' });
      await parity.page.goto(server.url('console/settings'));
      await expect(parity.page).toHaveURL(/\/login$/);
      expect(parity.network.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/refresh'))).toHaveLength(1);
    });
  });
}
