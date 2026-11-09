import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { base, route, secretPath, syntheticValue, rotationResult } from './console-secret-rotation-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';

const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-secret-rotation-page.json`, import.meta.url), 'utf8'))]));
const copy = (p) => bundles[p.locale];
const surface = (p) => p.page.getByTestId('console-secret-rotation-page');
const section = (p, name) => p.page.getByTestId(`rotation-${name}`);
const dialog = (p) => p.page.getByRole('alertdialog');
const button = (p, key) => p.page.getByRole('button', { name: copy(p)[key], exact: true });
const posts = (p) => p.network.requests.filter(({ method, path }) => method === 'POST' && path.startsWith(base));
const consumers = (p) => p.network.requests.filter(({ path }) => path === `${base}/consumer-status`);
const ready = (p) => expect(section(p, 'history').getByRole('table')).toBeVisible();
async function confirm(p) {
  await button(p, 'submit').click();
  await expect(dialog(p)).toBeVisible();
  await expect(dialog(p).getByRole('button', { name: copy(p).confirm, exact: true })).toBeDisabled();
  await dialog(p).getByRole('textbox', { name: copy(p).typedPath, exact: true }).fill(secretPath);
  await dialog(p).getByRole('button', { name: copy(p).confirm, exact: true }).click();
}
async function fill(p, grace = '3600') {
  await surface(p).getByRole('spinbutton', { name: copy(p).inputName, exact: true }).fill(grace);
  await surface(p).getByRole('textbox', { name: copy(p).justification, exact: true }).fill('synthetic planned rotation');
  await surface(p).getByLabel(copy(p).newValue, { exact: true }).fill(syntheticValue);
}
async function noLeak(p) {
  expect(await p.page.locator('body').textContent()).not.toContain(syntheticValue);
  expect(p.faults.join('\n')).not.toContain(syntheticValue);
}
async function capture(p, info, name) {
  await noLeak(p); await check.assertLocale(p);
  const body = await p.page.screenshot({ fullPage: true, animations: 'disabled' });
  await info.attach(`${name}-${p.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}

for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-secret-rotation-page | ${locale} | ${width}`, () => {
    test.use({ role: 'superadmin', locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test.beforeEach(async ({ parity }) => {
      // Suppress only browser resource diagnostics for the exact injected response URL.
      const failures = [];
      parity.page.on('console', (message) => { if (message.text().includes(syntheticValue)) parity.faults.push('Secret value reached a console message'); });
      parity.page.on('response', (response) => { if (response.url().includes(base) && response.status() >= 400) failures.push({ url: response.url(), kind: String(response.status()) }); });
      parity.page.on('requestfailed', (request) => { if (request.url().includes(base)) failures.push({ url: request.url(), kind: 'network' }); });
      parity.page.on('console', (message) => {
        if (message.type() !== 'error' || !consumeResourceDiagnostic(message.text(), message.location().url, failures)) return;
        const index = parity.faults.indexOf(`console.error: ${message.text()}`); if (index >= 0) parity.faults.splice(index, 1);
      });
    });
    test.afterEach(async ({ parity }) => {
      const owned = parity.network.requests.filter(({ path }) => path.startsWith('/v1/platform/secrets/'));
      for (const request of owned) {
        expect(request.path).not.toContain('/revoke');
        if (request.method === 'POST') {
          expect(request.path).toBe(`${base}/rotate`);
          expect(Object.keys(request.body).sort()).toEqual(['gracePeriodSeconds', 'justification', 'newValue']);
        } else {
          expect(request.method).toBe('GET');
          expect(request.path === `${base}/consumer-status` || new RegExp(`^${base}/history\\?limit=20&offset=(0|20|40)$`).test(request.path)).toBe(true);
        }
      }
      await noLeak(parity); await check.assertRuntimeHealth(parity);
    });
    test('data', async ({ parity }) => {
      const c = copy(parity); await parity.open(route, { rotationHistory: 'rotation-history', rotationConsumers: 'rotation-consumers-mixed' }); await ready(parity);
      await expect(surface(parity).getByRole('heading', { level: 1, name: c.title })).toBeVisible(); await expect(surface(parity).getByText(secretPath, { exact: true })).toBeVisible();
      for (const value of ['initiated', 'completed', 'synthetic-actor-a', 'synthetic-actor-b']) await expect(section(parity, 'history').getByText(value, { exact: true })).toBeVisible();
      await expect(section(parity, 'history').getByRole('cell', { name: c.missing, exact: true })).toHaveCount(5);
      for (const value of Object.values(c.states).slice(0, 3)) await expect(section(parity, 'consumers').getByText(value, { exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('slider', { name: c.sliderName })).toHaveAttribute('aria-valuenow', '1800');
      await expect(surface(parity).getByRole('spinbutton', { name: c.inputName })).toHaveValue('1800'); await check.assertLocale(parity);
      await parity.page.clock.install();
      for (const fixture of ['rotation-consumers-empty', 'rotation-consumers-pending-then-confirmed', 'rotation-consumers-all-timeout']) {
        await parity.open(route, { rotationConsumers: fixture }); await ready(parity); const before = consumers(parity).length;
        await parity.page.clock.runFor(5000);
        await expect.poll(() => consumers(parity).length).toBe(before + (fixture === 'rotation-consumers-all-timeout' ? 0 : 1));
        if (fixture !== 'rotation-consumers-empty') { const after = consumers(parity).length; await parity.page.clock.runFor(15000); expect(consumers(parity)).toHaveLength(after); }
      }
      for (const fixture of ['rotation-consumers-500-then-ok', 'rotation-consumers-network-then-ok']) {
        await parity.open(route, { rotationConsumers: fixture }); await ready(parity); await parity.page.clock.runFor(5000);
        await expect(section(parity, 'consumers').getByRole('heading', { name: c.consumersError })).toBeVisible();
        await expect(section(parity, 'consumers').getByRole('table', { name: c.staleTable })).toBeVisible();
        const before = consumers(parity).length; await section(parity, 'consumers').getByRole('button', { name: c.retry, exact: true }).click();
        await expect(section(parity, 'consumers').getByRole('heading', { name: c.consumersError })).toHaveCount(0);
        expect(consumers(parity)).toHaveLength(before + 1); await parity.page.clock.runFor(4999); expect(consumers(parity)).toHaveLength(before + 1);
        await parity.page.clock.runFor(1); await expect.poll(() => consumers(parity).length).toBe(before + 2);
      }
    });
    test('action', async ({ parity }) => {
      const c = copy(parity);
      await parity.open(route, { rotationHistory: ['rotation-history-page1', 'rotation-history-page2'], rotationSubmit: 'rotation-rotate-ok' }); await ready(parity); await fill(parity);
      await button(parity, 'submit').click(); await button(parity, 'cancel').click(); await expect(dialog(parity)).toHaveCount(0); await expect(button(parity, 'submit')).toBeFocused(); expect(posts(parity)).toHaveLength(0);
      await button(parity, 'submit').click(); await parity.page.keyboard.press('Escape'); await expect(dialog(parity)).toHaveCount(0); await expect(button(parity, 'submit')).toBeFocused();
      await confirm(parity); await expect(dialog(parity)).toHaveCount(0);
      expect(posts(parity).at(-1)).toEqual({ method: 'POST', path: `${base}/rotate`, body: { gracePeriodSeconds: 3600, justification: 'synthetic planned rotation', newValue: syntheticValue } });
      await expect(parity.page.locator('[data-live-announcer="polite"]')).toContainText(String(rotationResult.vaultVersionNew));
      await expect(parity.page.locator('[data-live-announcer="polite"]')).toContainText(rotationResult.graceExpiresAt);
      await expect(surface(parity).getByLabel(c.newValue, { exact: true })).toHaveValue(syntheticValue);
      await expect(surface(parity).getByLabel(c.newValue, { exact: true })).toHaveAttribute('type', 'password');
      await button(parity, 'next').click(); await expect(section(parity, 'history').getByText('synthetic-page-two', { exact: true })).toBeVisible();
      expect(parity.network.requests).toContainEqual({ method: 'GET', path: `${base}/history?limit=20&offset=20`, body: undefined });
      await button(parity, 'discard').click(); await expect(surface(parity).getByLabel(c.inputName)).toHaveValue('1800'); await expect(surface(parity).getByLabel(c.justification, { exact: true })).toHaveValue(''); await expect(surface(parity).getByLabel(c.newValue, { exact: true })).toHaveValue('');
      for (const value of [120, 0, 90000]) {
        await parity.open(route, { rotationSubmit: 'rotation-rotate-echo' }); await ready(parity);
        await surface(parity).getByLabel(c.inputName).fill(String(value)); await expect(surface(parity).getByRole('slider')).toHaveAttribute('aria-valuenow', String(Math.max(300, Math.min(86400, value))));
        await expect(surface(parity).getByLabel(c.justification, { exact: true })).toHaveAttribute('required', ''); await expect(surface(parity).getByLabel(c.justification, { exact: true })).not.toHaveAttribute('aria-required');
        await confirm(parity); await expect(dialog(parity)).toHaveCount(0); expect(posts(parity).at(-1).body).toEqual({ gracePeriodSeconds: value, justification: '', newValue: '' });
      }
      await parity.open(route, { rotationHistory: 'rotation-history-page2-500-then-ok' }); await ready(parity); await button(parity, 'next').click();
      await expect(section(parity, 'history').getByRole('heading', { name: c.historyError })).toBeVisible(); const before = consumers(parity).length;
      await section(parity, 'history').getByRole('button', { name: c.retry, exact: true }).click(); await expect(section(parity, 'history').getByText('synthetic-page-two', { exact: true })).toBeVisible(); expect(consumers(parity)).toHaveLength(before);
    });
    test('error-empty', async ({ parity }) => {
      const c = copy(parity);
      const loading = parity.open(route, { rotationHistory: 'rotation-delayed', rotationConsumers: 'rotation-delayed' }); await expect(surface(parity).getByRole('status', { name: c.loading })).toHaveCount(2); await loading; await ready(parity);
      await parity.open(route, { rotationHistory: 'rotation-history-empty', rotationConsumers: 'rotation-consumers-empty' }); await expect(section(parity, 'history').getByRole('heading', { name: c.historyEmpty })).toBeVisible(); await expect(section(parity, 'consumers').getByRole('heading', { name: c.consumersEmpty })).toBeVisible();
      for (const [fixture, heading] of [['rotation-403', 'noAccess'], ['rotation-history-404', 'notFound'], ['rotation-history-500', 'historyError'], ['rotation-history-500-no-id', 'historyError'], ['rotation-network', 'historyError']]) {
        await parity.open(route, { rotationHistory: fixture }); await expect(section(parity, 'history').getByRole('heading', { name: c[heading], exact: true })).toBeVisible();
        if (fixture === 'rotation-history-500') await expect(section(parity, 'history')).toContainText('req_synthetic_rotation');
        if (fixture === 'rotation-history-500-no-id') await expect(section(parity, 'history')).toContainText(c.noRequestId);
      }
      await parity.open(route, { rotationConsumers: 'rotation-403' }); await expect(section(parity, 'consumers').getByRole('heading', { name: c.noAccess })).toBeVisible();
      await parity.open(route, { rotationConsumers: 'rotation-consumers-404' }); await expect(section(parity, 'consumers').getByRole('link', { name: c.back })).toHaveAttribute('href', '/console/secrets');
      for (const fixture of ['rotation-rotate-400', 'rotation-rotate-403', 'rotation-rotate-404', 'rotation-rotate-500', 'rotation-rotate-503', 'rotation-rotate-network']) {
        await parity.open(route, { rotationSubmit: fixture }); await ready(parity); await fill(parity); const before = posts(parity).length; await confirm(parity);
        await expect(parity.page.getByTestId('validation-summary').getByRole('region')).toBeFocused(); await noLeak(parity); expect(posts(parity)).toHaveLength(before + 1);
      }
      for (const fixture of ['rotation-rotate-slow', 'rotation-rotate-slow-500']) {
        await parity.open(route, { rotationSubmit: fixture }); await ready(parity); const before = posts(parity).length; await confirm(parity);
        await expect(button(parity, 'submit')).toBeDisabled(); await expect(button(parity, 'discard')).toBeDisabled(); await expect(surface(parity).getByText(c.saving, { exact: true })).toBeVisible();
        await parity.page.keyboard.press('Enter'); await expect(button(parity, 'submit')).toBeEnabled(); expect(posts(parity)).toHaveLength(before + 1);
      }
      for (const invalid of ['sample-encodedSecretPath', 'platform%2Fpostgresql%2Fapp-password']) {
        const before = parity.network.requests.filter(({ path }) => path.startsWith(base)).length;
        await parity.open(`/console/secrets/${invalid}/rotate`); await expect(surface(parity).getByRole('heading', { level: 1, name: c.title })).toBeVisible(); await expect(surface(parity).getByRole('heading', { name: c.notFound })).toBeVisible(); await expect(surface(parity).locator('form')).toHaveCount(0);
        expect(parity.network.requests.filter(({ path }) => path.startsWith(base))).toHaveLength(before);
      }
      await parity.open(route, { rotationHistory: 'rotation-401' }); await expect(parity.page).toHaveURL(/\/login$/);
    });
    test('accessibility', async ({ parity }) => {
      const c = copy(parity); await parity.open(route, { rotationHistory: 'rotation-history-page1' }); await ready(parity); await check.assertAccessibility(parity); await check.assertLocale(parity);
      const slider = surface(parity).getByRole('slider', { name: c.sliderName }); await slider.focus(); await parity.page.keyboard.press('Home'); await expect(slider).toHaveAttribute('aria-valuenow', '300'); await parity.page.keyboard.press('End'); await expect(slider).toHaveAttribute('aria-valuenow', '86400');
      await parity.page.keyboard.press('Tab'); await expect(surface(parity).getByRole('spinbutton', { name: c.inputName })).toBeFocused();
      await parity.page.keyboard.press('Tab'); await expect(surface(parity).getByRole('textbox', { name: c.justification, exact: true })).toBeFocused();
      await parity.page.keyboard.press('Tab'); await expect(surface(parity).getByLabel(c.newValue, { exact: true })).toBeFocused();
      await parity.page.keyboard.press('Tab'); await expect(button(parity, 'showValue')).toBeFocused(); await parity.page.keyboard.press('Tab'); await expect(button(parity, 'discard')).toBeFocused(); await parity.page.keyboard.press('Tab'); await expect(button(parity, 'submit')).toBeFocused();
      await parity.page.keyboard.press('Enter'); await expect(dialog(parity).getByRole('textbox', { name: c.typedPath })).toBeFocused(); await check.assertAccessibility(parity); await check.assertLocale(parity);
      await parity.page.keyboard.press('Escape'); await expect(button(parity, 'submit')).toBeFocused();
      for (const fixture of ['rotation-rotate-400', 'rotation-rotate-403']) {
        await parity.open(route, { rotationSubmit: fixture }); await ready(parity); await confirm(parity); await expect(parity.page.getByTestId('validation-summary').getByRole('region')).toBeFocused(); await check.assertAccessibility(parity); await check.assertLocale(parity);
        await parity.page.getByTestId('validation-summary').getByRole('link').click(); await expect(surface(parity).getByLabel(c.justification, { exact: true })).toBeFocused();
      }
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
    test('runtime-health', async ({ parity }) => {
      // Reuse the shell's NavLink/useNavigate fixture through a page-local response
      // substitution; neither the shared fixture source nor the CSP harness changes.
      await parity.page.route('**/assets/FixtureRoutes-*.js', async (request) => {
        const response = await request.fetch();
        const source = await response.text();
        expect(source).toContain('/console/quotas');
        await request.fulfill({ response, body: source.replaceAll('/console/quotas', route) });
      });
      for (const method of ['link', 'navigate']) {
        await parity.open('/console/__fixture/quotas-link');
        const target = method === 'link' ? parity.page.locator('main a').last() : parity.page.locator('main section button').last();
        await target.click(); await ready(parity); await check.assertRuntimeHealth(parity);
      }
      await parity.page.unroute('**/assets/FixtureRoutes-*.js');
      await parity.open(route); await ready(parity); await check.assertRuntimeHealth(parity);
      await parity.page.clock.install();
      for (const fixture of ['rotation-rotate-500', 'rotation-rotate-network']) {
        await parity.open(route, { rotationSubmit: fixture }); await ready(parity); const before = posts(parity).length; await confirm(parity);
        await expect(parity.page.getByTestId('validation-summary').getByRole('region')).toBeFocused(); await parity.page.clock.runFor(60000); expect(posts(parity)).toHaveLength(before + 1);
      }
      await parity.open(route, { rotationConsumers: 'rotation-consumers-pending-then-confirmed', rotationHistory: 'rotation-history-404' });
      const before = consumers(parity).length;
      await parity.page.route('**/console/secrets', (request) => request.fulfill({ contentType: 'text/html', body: '<main>synthetic-secrets-return</main>' }));
      await section(parity, 'history').getByRole('link', { name: copy(parity).back }).click(); await expect(parity.page).toHaveURL(/\/console\/secrets$/);
      // Full-page return keeps the stored session; the old document's poller is gone.
      expect(await parity.page.evaluate(() => Boolean(sessionStorage.getItem('in-falcone.console-shell-session')))).toBe(true);
      await parity.page.clock.runFor(15000); expect(consumers(parity)).toHaveLength(before);
    });
    test('responsive', async ({ parity }) => {
      await parity.open(route); await ready(parity); await check.assertResponsive(parity, width); await button(parity, 'submit').click(); await check.assertResponsive(parity, width);
      await expect(button(parity, 'cancel')).toBeVisible(); await expect(dialog(parity).getByRole('button', { name: copy(parity).confirm })).toBeVisible();
    });
    test('visual-review', async ({ parity }, info) => {
      const c = copy(parity);
      await parity.open(route, { rotationHistory: 'rotation-history-page1', rotationConsumers: 'rotation-consumers-mixed' }); await ready(parity); await fill(parity); await capture(parity, info, 'unsaved-paged-history-mixed-consumers');
      await button(parity, 'submit').click(); await capture(parity, info, 'confirm-destructive'); await button(parity, 'cancel').click();
      await parity.open(route, { rotationSubmit: 'rotation-rotate-slow' }); await ready(parity); await fill(parity); await confirm(parity); await expect(button(parity, 'submit')).toBeDisabled(); await expect(dialog(parity)).toHaveCount(0); await capture(parity, info, 'saving'); await expect(button(parity, 'submit')).toBeEnabled();
      await parity.open(route, { rotationSubmit: 'rotation-rotate-ok' }); await ready(parity); await fill(parity); await confirm(parity); await expect(parity.page.getByRole('region', { name: c.notifications })).toContainText(rotationResult.graceExpiresAt); await capture(parity, info, 'success');
      for (const fixture of ['rotation-rotate-400', 'rotation-rotate-403']) {
        await parity.open(route, { rotationSubmit: fixture }); await ready(parity); await fill(parity); await confirm(parity); await expect(parity.page.getByTestId('validation-summary').getByRole('region')).toBeFocused(); await capture(parity, info, fixture);
      }
      await parity.page.clock.install(); await parity.open(route, { rotationConsumers: 'rotation-consumers-500-then-ok' }); await ready(parity); await parity.page.clock.runFor(5000); await expect(section(parity, 'consumers').getByRole('heading', { name: c.consumersError })).toBeVisible(); await capture(parity, info, 'consumer-error-stale');
      await parity.open(route, { rotationHistory: 'rotation-history-404' }); await expect(section(parity, 'history').getByRole('heading', { name: c.notFound })).toBeVisible(); await capture(parity, info, 'not-found');
    });
  });
}
