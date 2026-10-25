import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest from './welcome.manifest.ts';
import { sessionFor } from '../fixtures/shell.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { unexpectedWelcomeCopy } from './welcome-locale.mjs';

const copies = Object.fromEntries(['es', 'en'].map((locale) => [locale,
  JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.welcome-page.json`, import.meta.url), 'utf8')),
]));
const common = Object.fromEntries(['es', 'en'].map((locale) => [locale,
  JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/common.json`, import.meta.url), 'utf8')),
]));
const chunk = /\/assets\/welcome-[^/?]+\.js(?:\?.*)?$/;
const title = (page) => page.getByRole('heading', { level: 1, name: 'In Falcone Console', exact: true });
const links = (copy) => [[copy.back, 'login'], [copy.login, 'login'], [copy.signup, 'signup'], [copy.recovery, 'password-recovery']];

async function assertWelcomeLocale({ page, locale }) {
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page).toHaveTitle(copies[locale].documentTitle);
  // The required product title also occurs as translated copy in another page's
  // catalog. Validate this page's complete copy instead of a global English denylist.
  const allowed = [
    ...Object.values(copies[locale]), ...Object.values(common[locale].locale),
    common[locale].shell.console, common[locale].shell.about, common[locale].shell.userMenu,
    'Falcone', '.', // Preset logo wordmark.
  ];
  expect(await page.evaluate(unexpectedWelcomeCopy, allowed), 'locale: unexpected welcome copy').toEqual([]);
}

async function injectRenderFault(page) {
  await page.addInitScript(() => sessionStorage.setItem('welcome-render-fault', 'true'));
  await page.route(chunk, async (route) => {
    if (new URL(route.request().url()).searchParams.has('original')) return route.continue();
    const original = `${route.request().url()}?original=1`;
    await route.fulfill({ contentType: 'text/javascript', body: `import Welcome from ${JSON.stringify(original)}; export default function WelcomeFault() { if (sessionStorage.getItem('welcome-render-fault')) throw new Error('synthetic-welcome-failure'); return Welcome(); }` });
  });
}
async function assertBoundary(page, locale) {
  await expect(page.getByText('500', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(title(page)).toHaveCount(0);
  await expect(page.getByText(copies[locale].badge, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'In Falcone', exact: true })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/503|req_8f2c41d07a9b|acme-web|synthetic-welcome-failure/);
  await expect(page.getByRole('button', { name: locale === 'es' ? 'Reintentar' : 'Retry', exact: true })).toBeVisible();
}
async function capture(page, info, state, locale, width) {
  const body = await page.screenshot({ fullPage: true, animations: 'disabled' });
  const sha256 = createHash('sha256').update(body).digest('hex');
  await info.attach(`${state}-${locale}-${width}-sha256-${sha256}`, { body, contentType: 'image/png' });
}
async function holdChunk(page) {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const handler = async (route) => { await held; await route.continue(); };
  await page.route(chunk, handler);
  return async () => { release(); await page.unroute(chunk, handler); };
}

for (const role of manifest.roles) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`welcome | ${role} | ${locale} | ${width}`, () => {
    const copy = copies[locale];
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test.beforeEach(async ({ parity, server }) => {
      // Registered after the harness session seed: every ordinary run is anonymous.
      await parity.page.addInitScript(() => sessionStorage.removeItem('in-falcone.console-shell-session'));
      parity.open = async () => {
        await parity.page.goto(server.url(''));
        await expect(title(parity.page)).toBeVisible();
        await parity.page.evaluate(() => document.fonts.ready);
      };
    });
    test('data', async ({ parity }) => {
      await check.data(parity, manifest);
      for (const key of ['badge', 'intro', 'secureTitle', 'secureBody', 'signupTitle', 'signupBody', 'login', 'signup', 'recovery', 'back', 'help']) {
        await expect(parity.page.getByText(copy[key], { exact: true })).toBeVisible();
      }
      await expect(parity.page.getByRole('img', { name: copy.logo, exact: true })).toHaveCount(1);
      await expect(parity.page.getByRole('img', { name: copy.logo, exact: true }).locator('xpath=ancestor::a')).toHaveCount(0);
      await expect(parity.page.locator('body')).not.toContainText(/EP-\d+|US-UI|\/v1\/|roadmap|llegarán en T\d|fundación de consola lista|stack confirmado|Acme|This page will be available soon|Esta página estará disponible próximamente/);
      await expect(parity.page).toHaveTitle(copy.documentTitle);
      expect(parity.network.requests).toEqual([]);
    });
    test('action', async ({ parity, server }) => {
      for (const mechanism of ['pointer', 'keyboard']) for (const [name, destination] of links(copy)) {
        await parity.open();
        const link = parity.page.getByRole('link', { name, exact: true });
        expect(parity.network.requests).toEqual([]);
        await expect(link).toHaveAttribute('href', new URL(server.url(destination)).pathname);
        // A router transition retains this marker; a full document load would clear it.
        await parity.page.evaluate(() => { window.__welcomeDocument = true; });
        if (mechanism === 'pointer') await link.click();
        else { await link.focus(); await parity.page.keyboard.press('Enter'); }
        await expect(parity.page).toHaveURL(server.url(destination));
        expect(await parity.page.evaluate(() => window.__welcomeDocument)).toBe(true);
        await parity.page.goBack();
        await expect(title(parity.page)).toBeVisible();
        await expect(parity.page.getByRole('main')).toBeFocused();
      }
    });
    test('error-empty', async ({ parity, server }) => {
      const page = parity.page;
      const release = await holdChunk(page);
      try {
        await page.goto(server.url(''), { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('status').filter({ hasText: locale === 'es' ? 'Cargando' : 'Loading' })).toHaveCount(1);
        await expect(title(page)).toHaveCount(0);
        await page.waitForTimeout(2000);
      } finally { await release(); }
      await expect(title(page)).toBeVisible();
      // Neither a valid session nor an expired session may trigger refresh or redirect.
      for (const expired of [false, true]) {
        const session = sessionFor(role);
        if (expired) { session.expiresAt = '2000-01-01T00:00:00Z'; session.tokenSet.expiresAt = session.expiresAt; }
        await page.addInitScript((session) => sessionStorage.setItem('in-falcone.console-shell-session', JSON.stringify(session)), session);
        await parity.open();
        expect(parity.network.requests).toEqual([]);
        await expect(page).toHaveURL(server.url(''));
      }
      await injectRenderFault(page);
      await page.reload();
      await assertBoundary(page, locale);
      await page.evaluate(() => sessionStorage.removeItem('welcome-render-fault'));
      await page.getByRole('button', { name: locale === 'es' ? 'Reintentar' : 'Retry', exact: true }).click();
      await expect(title(page)).toBeVisible();
      await page.unroute(chunk);
      await page.route(chunk, (route) => route.abort('failed'));
      await page.reload();
      await assertBoundary(page, locale);
      expect(parity.network.requests).toEqual([]);
    });
    test('accessibility', async ({ parity, server }) => {
      await parity.open();
      const page = parity.page;
      await check.assertAccessibility(parity);
      await assertWelcomeLocale(parity);
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 2 })).toHaveCount(2);
      await expect(page.getByRole('region', { name: copy.title, exact: true })).toBeVisible();
      await expect(page.getByRole('main')).not.toBeFocused();
      const mainLinks = page.getByRole('main').getByRole('link');
      expect(await mainLinks.allTextContents()).toEqual(links(copy).map(([label]) => label));
      for (let index = 0; index < 4; index++) {
        if (index === 0) await mainLinks.nth(0).focus();
        else await page.keyboard.press('Tab');
        await expect(mainLinks.nth(index)).toBeFocused();
        const focus = await mainLinks.nth(index).evaluate((node) => {
          const style = getComputedStyle(node);
          return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
        });
        expect(focus).toBe(true);
        await expect(mainLinks.nth(index)).toHaveAccessibleName(links(copy)[index][0]);
      }
      await expect(page.locator('.welcome-actions svg[aria-hidden="true"]')).toHaveCount(2);
      await injectRenderFault(page);
      await page.goto(server.url(''));
      await assertBoundary(page, locale);
      await check.assertAccessibility(parity);
      await check.assertLocale(parity);
    });
    test('runtime-health', async ({ parity }) => {
      await parity.open();
      expect(parity.network.requests).toEqual([]);
      for (const [name] of links(copy)) {
        await parity.page.getByRole('link', { name, exact: true }).click();
        await expect(parity.page.getByRole('heading', { level: 1 })).toBeVisible();
        await parity.page.goBack();
        await expect(title(parity.page)).toBeVisible();
      }
      expect(parity.network.requests).toEqual([]);
      await check.assertRuntimeHealth(parity);
    });
    test('responsive', async ({ parity }) => {
      await parity.open();
      await check.assertResponsive(parity, width);
      const boxes = await parity.page.locator('.welcome-cards > div').evaluateAll((nodes) => nodes.map((node) => ({ x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y })));
      if (width === 375) expect(boxes[0].x).toBe(boxes[1].x);
      else expect(boxes[0].y).toBe(boxes[1].y);
      const actions = await parity.page.locator('.welcome-actions a').evaluateAll((nodes) => nodes.map((node) => ({ x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y, width: node.getBoundingClientRect().width })));
      if (width === 375) { expect(actions[0].x).toBe(actions[1].x); expect(actions[0].width).toBe(actions[1].width); }
      else expect(actions[0].y).toBe(actions[1].y);
    });
    test('visual-review', async ({ parity, server }, info) => {
      // Review artifacts require the checker's assessment and operator approval.
      const release = await holdChunk(parity.page);
      try {
        await parity.page.goto(server.url(''), { waitUntil: 'domcontentloaded' });
        await expect(parity.page.getByRole('status').filter({ hasText: locale === 'es' ? 'Cargando' : 'Loading' })).toHaveCount(1);
        await capture(parity.page, info, 'loading', locale, width);
      } finally { await release(); }
      await expect(title(parity.page)).toBeVisible();
      await parity.page.evaluate(() => document.fonts.ready);
      await assertWelcomeLocale(parity);
      await capture(parity.page, info, 'welcome', locale, width);
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
  });
}
