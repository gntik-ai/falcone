import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { navigationFixtures, statusPath } from './pendingActivation.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';

const copies = Object.fromEntries(['es', 'en'].map((locale) => [locale,
  JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.pending-activation-page.json`, import.meta.url), 'utf8')),
]));
const registration = navigationFixtures['nav-state.signup-registration'];
const request = { method: 'GET', path: statusPath, body: undefined };
const title = (page, copy) => page.getByRole('heading', { name: copy.title, level: 1, exact: true });
const variant = (name) => `auth.status-views.${name}`;
const negatives = async (page) => {
  await expect(page.locator('body')).not.toContainText(/RAW_SERVER|RAW_NAVIGATION|RAW_ERROR|req_8f2c41d07a9b|acme-web|EP-\d+|US-UI|This page will be available soon|Esta página estará disponible próximamente/);
  expect(await page.locator('[aria-label], [title], [data-live-announcer]').evaluateAll((nodes) => nodes.some((node) => /RAW_SERVER|RAW_NAVIGATION|RAW_ERROR/.test([node.textContent, node.getAttribute('aria-label'), node.getAttribute('title')].join(' '))))).toBe(false);
};
async function capture(page, info, state, locale, width) {
  const body = await page.screenshot({ fullPage: true, animations: 'disabled' });
  const sha256 = createHash('sha256').update(body).digest('hex');
  await info.attach(`${state}-${locale}-${width}-sha256-${sha256}`, { body, contentType: 'image/png' });
}
async function switchLocale(page, locale) {
  await page.locator('header > details').first().locator('summary').click();
  await page.locator('select').selectOption(locale);
  await page.locator('header > details').first().locator('summary').click();
}

for (const role of manifest.roles) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`pendingActivation | ${role} | ${locale} | ${width}`, () => {
    const copy = copies[locale];
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test.beforeEach(async ({ parity, server }) => {
      const page = parity.page;
      // This script follows the harness seed; navigation fixtures are history state, never backend data.
      await page.addInitScript(() => {
        sessionStorage.removeItem('in-falcone.console-shell-session');
        history.replaceState({ ...history.state, usr: JSON.parse(window.name || 'null') }, '', location.href);
      });
      let selected = '';
      // The shared harness recognizes failures only for older pages. Consume only the expected
      // browser resource diagnostic for this endpoint; application and CSP errors still fail.
      page.on('console', (message) => {
        if (message.type() !== 'error' || !message.location().url) return;
        if (new URL(message.location().url).pathname !== statusPath) return;
        const status = selected.match(/\.(401|403|404|500)(?:-|$)/)?.[1];
        const expected = status ? message.text().includes(`status of ${status}`)
          : selected.endsWith('.network') && /net::ERR_FAILED/.test(message.text());
        if (!expected || !message.text().startsWith('Failed to load resource:')) return;
        const index = parity.faults.indexOf(`console.error: ${message.text()}`);
        if (index >= 0) parity.faults.splice(index, 1);
      });
      parity.open = async (_route = manifest.route, options = {}) => {
        selected = options.variant ?? variant('pending-activation-with-actions');
        const state = options.state ? navigationFixtures[options.state] ?? options.state : null;
        parity.network.setVariants({ pendingActivation: selected });
        await page.evaluate((state) => { window.name = JSON.stringify(state); }, state);
        const start = parity.network.requests.length;
        await page.goto(server.url(manifest.route.slice(1)));
        await expect(title(page, copy)).toBeVisible();
        if (!options.loading) await expect(page.locator('[role="status"][aria-busy="true"]')).toHaveCount(0);
        if (!options.loading) await page.evaluate(() => document.fonts.ready);
        expect(parity.network.requests.slice(start)).toEqual([request]);
        await negatives(page);
      };
    });
    test('data', async ({ parity }) => {
      const page = parity.page;
      await check.data(parity, manifest);
      await expect(page.getByText(copy.statusMessage, { exact: true })).toBeVisible();
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByRole('img', { name: copy.logo, exact: true })).toHaveCount(1);
      await expect(page).toHaveTitle(copy.documentTitle);
      for (const language of [locale === 'es' ? 'en' : 'es', locale]) {
        await switchLocale(page, language);
        for (const key of ['start_login', 'create_account', 'recover_password']) {
          await expect(page.getByRole('link', { name: copies[language].actions[key], exact: true })).toHaveAccessibleName(copies[language].actions[key]);
        }
        await negatives(page);
      }
      for (const key of ['start_login', 'create_account', 'recover_password']) await expect(page.getByRole('link', { name: copy.actions[key], exact: true })).toHaveCount(1);
      await parity.open(manifest.route, { variant: variant('unknown-action') });
      await expect(page.getByRole('link', { name: copy.actions.unknown, exact: true })).toHaveAttribute('href', '/help?source=pending#support');
      await parity.open(manifest.route, { variant: variant('500'), state: 'nav-state.signup-registration' });
      await expect(page.getByText(copy.approvalPending, { exact: true })).toBeVisible();
      await expect(page.getByText(copy.reference.replace('{id}', registration.registrationId), { exact: true })).toBeVisible();
      for (const language of [locale === 'es' ? 'en' : 'es', locale]) {
        await switchLocale(page, language);
        await expect(title(page, copies[language])).toBeVisible();
        await expect(page.getByText(copies[language].approvalPending, { exact: true })).toBeVisible();
        await expect(page.getByText(copies[language].reference.replace('{id}', registration.registrationId), { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: copies[language].retry, exact: true })).toHaveAccessibleName(copies[language].retry);
        await negatives(page);
      }
      await page.reload();
      await expect(page.getByText(copy.approvalPending, { exact: true })).toBeVisible();
      await parity.open(manifest.route, { variant: variant('unknown-status'), state: 'nav-state.signup-unknown-mode' });
      await expect(page.getByText(copy.fallbackMessage, { exact: true })).toBeVisible();
    });
    test('action', async ({ parity, server }) => {
      const page = parity.page;
      for (const state of ['pending-activation-with-actions', '403', '404']) {
        for (const [name, destination] of [[copy.login, 'login'], [copy.signup, 'signup']]) {
          await parity.open(manifest.route, { variant: variant(state) });
          const link = page.getByRole('link', { name, exact: true });
          await expect(link).toHaveCount(1);
          await expect(link).toHaveAttribute('href', new URL(server.url(destination)).pathname);
          await link.focus(); await page.keyboard.press('Enter');
          await expect(page).toHaveURL(server.url(destination));
        }
      }
      for (const [key, destination] of [['start_login', 'login'], ['create_account', 'signup'], ['recover_password', 'password-recovery']]) {
        await parity.open();
        const link = page.getByRole('link', { name: copy.actions[key], exact: true });
        await expect(link).toHaveAttribute('href', new URL(server.url(destination)).pathname);
        await page.evaluate(() => { window.__pendingDocument = true; });
        await link.click();
        await expect(page).toHaveURL(server.url(destination));
        expect(await page.evaluate(() => window.__pendingDocument)).toBe(true);
      }
      await parity.open(manifest.route, { variant: variant('500-then-success'), state: 'nav-state.signup-registration' });
      const start = parity.network.requests.length;
      await page.getByRole('button', { name: copy.retry, exact: true }).click();
      await expect(page.getByText(copy.statusMessage, { exact: true })).toBeVisible();
      expect(parity.network.requests.slice(start)).toEqual([request]);
    });
    test('error-empty', async ({ parity }) => {
      const page = parity.page;
      await parity.open(manifest.route, { variant: variant('delayed'), loading: true });
      await expect(page.getByText(copy.loading, { exact: true })).toHaveCount(1);
      await expect(page.getByRole('link', { name: copy.login, exact: true })).toBeVisible();
      await expect(page.locator('[role="status"][aria-busy="true"]')).toHaveCount(0);
      for (const state of ['no-actions', '401', '403', '404', '500', 'network']) {
        await parity.open(manifest.route, { variant: variant(state), state: 'nav-state.signup-registration' });
        await expect(page.getByText(copy.reference.replace('{id}', registration.registrationId), { exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: copy.login, exact: true })).toHaveCount(1);
        await expect(page.getByRole('link', { name: copy.signup, exact: true })).toHaveCount(1);
        if (['403', '404'].includes(state)) {
          await expect(page.getByRole('heading', { name: state === '403' ? copy.noAccessTitle : copy.notFoundTitle, exact: true })).toBeVisible();
          await expect(page.getByRole('group', { name: copy.statusTitle, exact: true })).toHaveCount(0);
          await expect(page.getByRole('button', { name: copy.retry, exact: true })).toHaveCount(0);
          if (state === '404') await expect(page.getByText(`${copy.notFoundDescription} ${copy.approvalPending}`, { exact: true })).toBeVisible();
        } else if (state !== 'no-actions') {
          await expect(page.getByRole('heading', { name: copy.errorTitle, exact: true })).toBeVisible();
          await expect(page.getByText(copy.approvalPending, { exact: true })).toBeVisible();
          await expect(page.getByRole('button', { name: copy.retry, exact: true })).toBeVisible();
        }
        if (state === '500') {
          await expect(page.getByText('synthetic-pending-request', { exact: true })).toBeVisible();
          await expect(page.getByRole('button', { name: copy.copyRequestId, exact: true })).toBeVisible();
        }
        await negatives(page);
      }
      await parity.open(manifest.route, { variant: variant('no-actions') });
      await expect(page.getByText(copy.referenceTitle, { exact: true })).toHaveCount(0);
      await expect(page.getByRole('main').getByRole('link')).toHaveCount(2);
    });
    test('accessibility', async ({ parity }) => {
      const page = parity.page;
      for (const state of ['pending-activation-with-actions', '403', '404', '500-twice-then-success']) {
        await parity.open(manifest.route, { variant: variant(state), state: 'nav-state.signup-registration' });
        await check.assertAccessibility(parity); await check.assertLocale(parity);
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
        if (state.startsWith('500')) {
          const retry = page.getByRole('button', { name: copy.retry, exact: true });
          await retry.focus(); await page.keyboard.press('Enter');
          await expect(retry).toBeFocused();
          // The shell and page each own a region; the nearest announcer receives the message.
          await expect(page.locator('[data-live-announcer="assertive"]')).toContainText([copy.errorTitle]);
          await page.keyboard.press('Enter');
          await expect(page.getByRole('group', { name: copy.statusTitle, exact: true })).toBeFocused();
          await expect(page.locator('[data-live-announcer="polite"]')).toContainText([copy.statusTitle]);
        }
        const links = page.getByRole('main').getByRole('link');
        const names = state.startsWith('pending') || state.startsWith('500')
          ? [copy.actions.start_login, copy.actions.create_account, copy.actions.recover_password, copy.login, copy.signup] : [copy.login, copy.signup];
        expect(await links.allTextContents()).toEqual(names);
        for (let index = 0; index < names.length; index++) {
          if (index === 0 && !state.startsWith('500')) await links.nth(0).focus();
          else await page.keyboard.press('Tab');
          await expect(links.nth(index)).toBeFocused();
          await expect(links.nth(index)).toHaveAccessibleName(names[index]);
          expect(await links.nth(index).evaluate((node) => {
            const style = getComputedStyle(node); return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
          })).toBe(true);
        }
      }
    });
    test('runtime-health', async ({ parity }) => {
      for (const state of ['pending-activation-with-actions', '500-then-success']) {
        await parity.open(manifest.route, { variant: variant(state), state: 'nav-state.signup-registration' });
        if (state.startsWith('500')) {
          await parity.page.getByRole('button', { name: copy.retry, exact: true }).click();
          await expect(parity.page.getByText(copy.statusMessage, { exact: true })).toBeVisible();
        }
        await switchLocale(parity.page, locale === 'es' ? 'en' : 'es');
        await switchLocale(parity.page, locale);
        await check.assertRuntimeHealth(parity);
      }
      // Unmount aborts the held status read; the destination reads only its signup policy.
      await parity.open(manifest.route, { variant: variant('delayed'), loading: true });
      const start = parity.network.requests.length;
      await parity.page.getByRole('link', { name: copy.login, exact: true }).click();
      await expect(parity.page.getByRole('heading', { level: 1 })).toBeVisible();
      await parity.page.waitForTimeout(1600);
      expect(parity.network.requests.slice(start)).toEqual([
        { method: 'GET', path: '/v1/auth/signups/policy', body: undefined },
      ]);
      await check.assertRuntimeHealth(parity);
    });
    test('responsive', async ({ parity }) => {
      for (const state of ['pending-activation-with-actions', '403', '404', '500']) {
        await parity.open(manifest.route, { variant: variant(state), state: { ...registration, registrationId: 'synthetic-reference-'.repeat(12) } });
        await check.assertResponsive(parity, width);
        for (const link of await parity.page.getByRole('main').getByRole('link').all()) {
          const box = await link.boundingBox();
          expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
        }
      }
    });
    test('visual-review', async ({ parity }, info) => {
      for (const state of ['pending-activation-with-actions', 'delayed', 'unknown-status', '403', '404', '500']) {
        await parity.open(manifest.route, { variant: variant(state), state: 'nav-state.signup-registration', loading: state === 'delayed' });
        if (state === 'delayed') await expect(parity.page.getByText(copy.loading, { exact: true })).toHaveCount(1);
        await check.assertLocale(parity);
        await capture(parity.page, info, state, locale, width);
      }
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
  });
}
