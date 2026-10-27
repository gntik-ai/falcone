import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest from './not-found-page.manifest.ts';
import { sessionFor } from '../fixtures/shell.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { unexpectedWelcomeCopy } from './welcome-locale.mjs';
import { allowedNotFoundCopy } from './not-found-locale.mjs';

const copies = Object.fromEntries(['es', 'en'].map((locale) => [locale,
  JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.not-found-page.json`, import.meta.url), 'utf8')),
]));
const common = Object.fromEntries(['es', 'en'].map((locale) => [locale,
  JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/common.json`, import.meta.url), 'utf8')),
]));
const chunk = /\/assets\/notFound-[^/?]+\.js(?:\?.*)?$/;
const heading = (page, locale) => page.getByRole('heading', { level: 1, name: copies[locale].title, exact: true });
const link = (page, name) => page.getByRole('link', { name, exact: true });
const back = (page, locale) => page.getByRole('button', { name: copies[locale].back, exact: true });

async function storeSession(page, session) {
  await page.evaluate((value) => {
    if (value) sessionStorage.setItem('in-falcone.console-shell-session', JSON.stringify(value));
    else sessionStorage.removeItem('in-falcone.console-shell-session');
  }, session);
}
async function arriveInApp(parity, server, session = null) {
  const page = parity.page;
  await page.goto(server.url('login'));
  await expect(page.getByRole('heading', { level: 1, name: parity.locale === 'es' ? 'Accede a In Falcone Console' : 'Sign in to In Falcone Console', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: parity.locale === 'es' ? 'Solicita acceso o crea tu cuenta' : 'Request access or create your account', exact: true })).toBeVisible();
  await storeSession(page, session);
  // Model a router history entry without reloading the document. BrowserRouter
  // consumes the popstate event, and the idx makes navigate(-1) return to login.
  await page.evaluate((url) => {
    window.__notFoundDocument = true;
    history.pushState({ idx: (history.state?.idx ?? 0) + 1, key: 'synthetic-not-found' }, '', url);
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  }, server.url('does-not-exist'));
  await expect(heading(page, parity.locale)).toBeVisible();
  await expect(heading(page, parity.locale)).toBeFocused();
  await expect(back(page, parity.locale)).toBeVisible();
  expect(await page.evaluate(() => window.__notFoundDocument)).toBe(true);
}
async function assertCopy(parity) {
  const { page, locale } = parity;
  await check.assertLocale(parity);
  await expect(page).toHaveTitle(copies[locale].documentTitle);
  const allowed = allowedNotFoundCopy(copies[locale], common[locale]);
  expect(await page.evaluate(unexpectedWelcomeCopy, allowed), 'locale: unexpected not-found copy').toEqual([]);
}
async function capture(page, info, state, locale, width) {
  await page.evaluate(() => document.fonts.ready);
  const body = await page.screenshot({ fullPage: true, animations: 'disabled' });
  const sha256 = createHash('sha256').update(body).digest('hex');
  await info.attach(`${state}-${locale}-${width}-sha256-${sha256}`, { body, contentType: 'image/png' });
}
async function assertBoundary(page, locale) {
  await expect(page.getByText('500', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(heading(page, locale)).toHaveCount(0);
  await expect(page.getByRole('button', { name: common[locale].shell.retry, exact: true })).toBeVisible();
}
async function holdChunk(page) {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const handler = async (route) => { await held; await route.continue(); };
  await page.route(chunk, handler);
  return async () => { release(); await page.unroute(chunk, handler); };
}

for (const role of manifest.roles) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`not-found-page | ${role} | ${locale} | ${width}`, () => {
    const copy = copies[locale];
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test.beforeEach(async ({ parity, server }) => {
      // Register after the harness seed so session.none is actually anonymous.
      await parity.page.addInitScript(() => sessionStorage.removeItem('in-falcone.console-shell-session'));
      parity.open = async () => {
        await parity.page.goto(server.url('does-not-exist'));
        await expect(heading(parity.page, locale)).toBeVisible();
        await parity.page.evaluate(() => document.fonts.ready);
      };
    });
    test('data', async ({ parity, server }) => {
      await check.data(parity, manifest);
      const page = parity.page;
      await expect(page.getByText(copy.code, { exact: true })).toBeVisible();
      await expect(page.getByText(copy.description, { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(link(page, copy.login)).toHaveAttribute('href', new URL(server.url('login')).pathname);
      await expect(back(page, locale)).toHaveCount(0);
      await expect(page.getByRole('img', { name: copy.logo, exact: true })).toHaveCount(1);
      await expect(page.getByRole('main').getByRole('navigation')).toHaveCount(0);
      await expect(page.getByRole('tablist')).toHaveCount(0);
      await expect(page.locator('main dl, footer')).toHaveCount(0);
      await expect(page.getByRole('main').getByRole('link')).toHaveCount(2);
      await assertCopy(parity);
      await arriveInApp(parity, server, sessionFor(role));
      await expect(link(page, copy.console)).toHaveAttribute('href', new URL(server.url('console')).pathname);
      await expect(link(page, copy.login)).toHaveCount(0);
      expect(parity.network.requests.filter((request) => request.path !== '/v1/auth/signups/policy')).toEqual([]);
    });
    test('action', async ({ parity, server }) => {
      const page = parity.page;
      for (const method of ['pointer', 'keyboard']) {
        await parity.open();
        expect(parity.network.requests.filter((request) => request.path !== '/v1/auth/signups/policy')).toEqual([]);
        if (method === 'pointer') await link(page, copy.login).click();
        else { await link(page, copy.login).focus(); await page.keyboard.press('Enter'); }
        await expect(page).toHaveURL(server.url('login'));
        await parity.open();
        await link(page, copy.home).click();
        await expect(page).toHaveURL(server.url(''));
        await arriveInApp(parity, server, sessionFor(role));
        await storeSession(page, null);
        await back(page, locale).focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(server.url('login'));
        expect(await page.evaluate(() => window.__notFoundDocument)).toBe(true);
      }
      expect(parity.network.requests.filter((request) => request.path !== '/v1/auth/signups/policy')).toEqual([]);
      await arriveInApp(parity, server, sessionFor(role));
      await link(page, copy.console).click();
      // Requests made by the destination console shell are outside the 404 page.
      await expect(page).toHaveURL(server.url('console/overview'));
    });
    test('error-empty', async ({ parity, server }) => {
      const page = parity.page;
      const release = await holdChunk(page);
      try {
        await page.goto(server.url('does-not-exist'), { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('status').filter({ hasText: common[locale].states.loading.title })).toHaveCount(1);
        await expect(page.getByRole('main')).toBeVisible();
        await expect(heading(page, locale)).toHaveCount(0);
      } finally { await release(); }
      await expect(heading(page, locale)).toBeVisible();
      await expect(back(page, locale)).toHaveCount(0);
      const expired = sessionFor(role);
      expired.expiresAt = expired.tokenSet.expiresAt = '2000-01-01T00:00:00Z';
      await arriveInApp(parity, server, expired);
      await expect(link(page, copy.login)).toBeVisible();
      expect(parity.network.requests.filter((request) => request.path !== '/v1/auth/signups/policy')).toEqual([]);
      for (const error of ['failed', 'internetdisconnected']) {
        await page.route(chunk, (route) => route.abort(error));
        await page.goto(server.url('does-not-exist'));
        await assertBoundary(page, locale);
        await page.unroute(chunk);
      }
    });
    test('accessibility', async ({ parity, server }) => {
      const page = parity.page;
      for (const session of [null, sessionFor(role)]) {
        if (session) await arriveInApp(parity, server, session);
        else await parity.open();
        await check.assertAccessibility(parity);
        await assertCopy(parity);
        await expect(heading(page, locale)).toBeFocused();
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
        const actions = [link(page, session ? copy.console : copy.login), link(page, copy.home), ...(session ? [back(page, locale)] : [])];
        for (const action of actions) {
          await page.keyboard.press('Tab');
          await expect(action).toBeFocused();
          expect(await action.evaluate((node) => {
            const style = getComputedStyle(node);
            return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
          })).toBe(true);
        }
        await expect(page.locator('main svg[aria-hidden="true"]')).toHaveCount(session ? 2 : 1);
        if (session) {
          await storeSession(page, null);
          await page.keyboard.press('Enter');
          await expect(page).toHaveURL(server.url('login'));
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        }
      }
      await page.route(chunk, (route) => route.abort('failed'));
      await page.goto(server.url('does-not-exist'));
      await assertBoundary(page, locale);
      await check.assertAccessibility(parity);
      await check.assertLocale(parity);
      const retry = page.getByRole('button', { name: common[locale].shell.retry, exact: true });
      for (let step = 0; step < 12 && !await retry.evaluate((node) => node === document.activeElement); step++) await page.keyboard.press('Tab');
      await expect(retry).toBeFocused();
    });
    test('runtime-health', async ({ parity, server }) => {
      await parity.open();
      await check.assertRuntimeHealth(parity);
      for (const session of [null, sessionFor(role)]) {
        await arriveInApp(parity, server, session);
        await check.assertRuntimeHealth(parity);
        await storeSession(parity.page, null);
        await back(parity.page, locale).click();
        await expect(parity.page).toHaveURL(server.url('login'));
        await check.assertRuntimeHealth(parity);
      }
      expect(parity.network.requests.filter((request) => request.path !== '/v1/auth/signups/policy')).toEqual([]);
      // Nested unknown console routes retain their shell handler.
      await storeSession(parity.page, sessionFor(role));
      await parity.page.evaluate((url) => {
        history.pushState({ idx: (history.state?.idx ?? 0) + 1 }, '', url);
        window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
      }, server.url('console/not-a-console-page'));
      await expect(parity.page.getByRole('heading', { name: common[locale].states.unknown.title, exact: true })).toBeVisible();
      await expect(parity.page.getByText(copy.description, { exact: true })).toHaveCount(0);
      await check.assertRuntimeHealth(parity);
    });
    test('responsive', async ({ parity, server }) => {
      for (const authenticated of [false, true]) {
        if (authenticated) await arriveInApp(parity, server, sessionFor(role));
        else await parity.open();
        await check.assertResponsive(parity, width);
        const boxes = await parity.page.locator('main a, main button').evaluateAll((nodes) => nodes.map((node) => {
          const { x, y, width } = node.getBoundingClientRect(); return { x, y, width };
        }));
        if (width === 375) {
          for (const box of boxes) { expect(box.x).toBe(boxes[0].x); expect(box.width).toBe(boxes[0].width); }
          expect(boxes[1].y).toBeGreaterThan(boxes[0].y);
        } else for (const box of boxes) expect(box.y).toBe(boxes[0].y);
      }
    });
    test('visual-review', async ({ parity, server }, info) => {
      await parity.open();
      await assertCopy(parity);
      await capture(parity.page, info, 'fresh-anonymous', locale, width);
      await arriveInApp(parity, server, sessionFor(role));
      await assertCopy(parity);
      await capture(parity.page, info, 'in-app-authenticated-with-back', locale, width);
      await parity.page.route(chunk, (route) => route.abort('failed'));
      await parity.page.goto(server.url('does-not-exist'));
      await assertBoundary(parity.page, locale);
      await capture(parity.page, info, 'failed-chunk-status-500', locale, width);
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
  });
}
