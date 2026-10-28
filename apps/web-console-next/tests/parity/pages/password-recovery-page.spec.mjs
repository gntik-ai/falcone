import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { recoveryPath, recoveryTicket } from './password-recovery-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';

const copies = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.password-recovery-page.json`, import.meta.url), 'utf8'))]));
const loginCopies = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.login-page.json`, import.meta.url), 'utf8'))]));
const payload = { usernameOrEmail: 'operaciones@example.com', deliveryChannel: 'email' };
for (const role of manifest.roles) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`password-recovery-page | ${role} | ${locale} | ${width}`, () => {
    const copy = copies[locale];
    const loginCopy = loginCopies[locale];
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    const field = (page) => page.getByLabel(copy.identifier, { exact: true });
    const submitButton = (page) => page.getByRole('button', { name: copy.submit, exact: true });
    const retryButton = (page) => page.getByRole('button', { name: copy.retry, exact: true });
    const back = (page) => page.getByRole('link', { name: copy.back, exact: true });
    let recoveryRequests, failedResources, resourceDiagnostics;
    test.beforeEach(async ({ parity }) => {
      // This runs after the harness session seed, so recovery is always anonymous.
      await parity.page.addInitScript(() => sessionStorage.removeItem('in-falcone.console-shell-session'));
      recoveryRequests = []; failedResources = []; resourceDiagnostics = [];
      parity.page.on('request', (request) => {
        if (new URL(request.url()).pathname === recoveryPath) recoveryRequests.push(request);
      });
      // The shared monitor does not yet list recovery. Permit only browser resource
      // diagnostics matched one-for-one to this spec's injected recovery failures.
      // Application errors, rejections, CSP violations and other URLs remain faults.
      parity.page.on('response', (response) => {
        if (new URL(response.url()).pathname === recoveryPath && response.status() >= 400) failedResources.push({ url: response.url(), kind: String(response.status()) });
      });
      parity.page.on('requestfailed', (request) => {
        if (new URL(request.url()).pathname === recoveryPath) failedResources.push({ url: request.url(), kind: 'network' });
      });
      parity.page.on('console', (message) => {
        const kind = /^Failed to load resource: the server responded with a status of (400|401|403|404|429|500)(?: \([^\n]*\))?$/.exec(message.text())?.[1]
          ?? (/^Failed to load resource: net::ERR_FAILED$/.test(message.text()) ? 'network' : null);
        if (message.type() === 'error' && kind && new URL(message.location().url || 'http://invalid/').pathname === recoveryPath) resourceDiagnostics.push({ url: message.location().url, kind, fault: `console.error: ${message.text()}` });
      });
    });
    async function runtimeHealth(parity) {
      await parity.page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
      const faults = [...parity.faults], failures = [...failedResources];
      for (const diagnostic of resourceDiagnostics) {
        const injected = failures.findIndex((failure) => failure.url === diagnostic.url && failure.kind === diagnostic.kind);
        const fault = faults.indexOf(diagnostic.fault);
        if (injected >= 0 && fault >= 0) { failures.splice(injected, 1); faults.splice(fault, 1); }
      }
      await check.assertRuntimeHealth({ ...parity, faults });
    }
    async function open(parity, variant = 'success') {
      await parity.open(manifest.route, { recovery: variant });
      await expect(parity.page.getByRole('heading', { level: 1, name: copy.title, exact: true })).toBeVisible();
      await expect(field(parity.page)).toBeFocused();
    }
    async function submit(page, value = '  operaciones@example.com  ') {
      await field(page).fill(value);
      await submitButton(page).click();
    }
    async function success(page) { await expect(page.getByText(copy.successTitle, { exact: true })).toBeVisible(); }
    async function privacy(page) {
      await expect(page.locator('body')).not.toContainText(/RAW_SERVER_MESSAGE|req_8f2c41d07a9b|Acme|EP-\d+|US-UI|\/v1\//);
      await expect(page.getByRole('button', { name: /resend|reenviar|request access|solicitar acceso|support|soporte/i })).toHaveCount(0);
    }
    async function assertRequests(parity, start = 0, count = 1) {
      expect(parity.network.requests.slice(start)).toEqual(Array.from({ length: count }, () => ({ method: 'POST', path: recoveryPath, body: payload })));
      for (const request of recoveryRequests) {
        expect(request.method()).toBe('POST');
        expect(request.postDataJSON()).toEqual(payload);
        expect(request.headers()['idempotency-key']).toMatch(/^idem_.+/);
        expect(request.headers().authorization).toBeUndefined();
      }
    }
    async function capture(page, info, state) {
      await page.evaluate(() => document.fonts.ready);
      const body = await page.screenshot({ fullPage: true, animations: 'disabled' });
      const sha256 = createHash('sha256').update(body).digest('hex');
      await info.attach(`${state}-${locale}-${width}-sha256-${sha256}`, { body, contentType: 'image/png' });
    }
    async function holdRequest(page, action, pending) {
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      const handler = async (route) => { await held; await route.fallback(); };
      await page.route(`**${recoveryPath}`, handler);
      try { await action(); await pending(); }
      finally { release(); await page.unroute(`**${recoveryPath}`, handler); }
    }
    const titleFor = (variant) => copy[({ '400': 'invalidTitle', '403': 'deniedTitle', '404': 'missingTitle', '429': 'restrictedTitle' })[variant] ?? 'serviceTitle'];

    test('data', async ({ parity }) => {
      const page = parity.page;
      await open(parity);
      expect(parity.network.requests).toEqual([]);
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByRole('img', { name: copy.logo, exact: true })).toHaveCount(1);
      await expect(page).toHaveTitle(copy.documentTitle);
      await expect(page.getByText(copy.asideDelivery, { exact: true })).toBeVisible();
      await expect(page.getByText(copy.asideOperator, { exact: true })).toBeVisible();
      await expect(page.getByText(copy.ticketTitle, { exact: true })).toHaveCount(0);
      for (const variant of ['delivered', 'pending-delivery', 'completed', 'expired']) {
        await open(parity, variant);
        const start = parity.network.requests.length;
        await submit(page); await success(page);
        const status = variant === 'pending-delivery' ? 'pending_delivery' : variant;
        await expect(page.getByText(copy.status.replace('{status}', copy.statuses[status]), { exact: true })).toBeVisible();
        await expect(page.getByText(copy.destination.replace('{destination}', recoveryTicket.maskedDestination), { exact: true })).toBeVisible();
        const expiry = await page.evaluate(({ locale, value }) => new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)), { locale, value: recoveryTicket.expiresAt });
        await expect(page.locator('time')).toHaveText(expiry);
        await expect(page.locator('time')).toHaveAttribute('datetime', recoveryTicket.expiresAt);
        await expect(page.getByText(copy.successMessage, { exact: true })).toBeVisible();
        await assertRequests(parity, start); await privacy(page); await check.assertLocale(parity);
      }
    });
    test('action', async ({ parity, server }) => {
      const page = parity.page;
      await open(parity);
      for (const value of ['', '   ']) {
        await submit(page, value);
        await expect(field(page)).toBeFocused();
        await expect(page.getByRole('alert')).toHaveText(copy.required);
        expect(parity.network.requests).toEqual([]);
      }
      await submit(page); await success(page);
      await holdRequest(page, () => submit(page), async () => {
        await expect(page.getByText(copy.ticketTitle, { exact: true })).toHaveCount(0);
        await expect(page.getByText(copy.successTitle, { exact: true })).toHaveCount(0);
      });
      await success(page); await assertRequests(parity, 0, 2);
      await open(parity, '500-then-success');
      const start = parity.network.requests.length;
      await submit(page); await expect(retryButton(page)).toBeVisible();
      await retryButton(page).click(); await success(page);
      await expect(submitButton(page)).toBeFocused(); await assertRequests(parity, start, 2);
      for (const variant of ['success', '403', '404']) {
        await open(parity, variant);
        if (variant !== 'success') { await submit(page); await expect(page.getByText(titleFor(variant), { exact: true })).toBeVisible(); }
        await expect(back(page)).toHaveCount(1);
        await expect(back(page)).toHaveAttribute('href', new URL(server.url('login')).pathname);
        await page.evaluate(() => { window.__recoveryDocument = true; });
        const before = parity.network.requests.length;
        await back(page).click();
        await expect(page.getByRole('heading', { level: 1, name: loginCopy.title, exact: true })).toBeVisible();
        expect(await page.evaluate(() => window.__recoveryDocument)).toBe(true);
        expect(parity.network.requests.slice(before).filter((request) => request.path !== '/v1/auth/signups/policy')).toEqual([]);
        await page.getByRole('link', { name: loginCopy.labels.passwordRecovery, exact: true }).click();
        await expect(field(page)).toBeFocused();
      }
    });
    test('error-empty', async ({ parity, server }) => {
      const page = parity.page;
      for (const variant of ['400', '401', '403', '404', '429', '500', 'network']) {
        await open(parity, variant);
        const start = parity.network.requests.length;
        await submit(page);
        const outcome = page.getByText(titleFor(variant), { exact: true });
        await expect(outcome).toBeVisible();
        const destructive = ['400', '401', '500', 'network'].includes(variant);
        await expect(outcome.locator(`xpath=ancestor::*[@role='${destructive ? 'alert' : 'status'}']`)).toHaveCount(1);
        await expect(submitButton(page)).toBeFocused();
        await expect(field(page)).toBeEnabled();
        await expect(back(page)).toHaveCount(1);
        await expect(page.getByText(copy.ticketTitle, { exact: true })).toHaveCount(0);
        if (variant === '500') await expect(page.getByText('synthetic-recovery-request', { exact: true })).toBeVisible();
        if (variant === '401') await expect(page).toHaveURL(server.url('password-recovery'));
        await assertRequests(parity, start); await privacy(page); await check.assertLocale(parity);
      }
      await open(parity);
      await holdRequest(page, () => submit(page), async () => {
        await expect(page.getByRole('button', { name: copy.submitting, exact: true })).toBeDisabled();
        await expect(page.getByRole('button', { name: copy.submitting, exact: true })).toHaveAttribute('aria-busy', 'true');
        await expect(page.locator('[role="status"][aria-busy="true"]')).toHaveCount(1);
        await expect(page.locator('[role="status"][aria-busy="true"]')).toHaveText(copy.submitting);
      });
      await success(page);
    });
    test('accessibility', async ({ parity }) => {
      const page = parity.page;
      await open(parity);
      await expect(field(page)).toHaveAttribute('minlength', '3');
      await expect(field(page)).toHaveAttribute('maxlength', '255');
      await expect(field(page)).toHaveAttribute('aria-describedby', 'password-recovery-username-help');
      await expect(page.locator('form')).toHaveAttribute('novalidate', '');
      await page.keyboard.press('Tab'); await expect(submitButton(page)).toBeFocused();
      await page.keyboard.press('Tab'); await expect(back(page)).toBeFocused();
      await submit(page, '');
      await expect(field(page)).toBeFocused();
      await expect(field(page)).toHaveAttribute('aria-describedby', 'password-recovery-username-help password-recovery-username-required');
      await check.assertAccessibility(parity);
      for (const variant of ['success', '400', '401', '403', '404', '429', '500', 'network']) {
        await open(parity, variant); await check.assertAccessibility(parity);
        await submit(page);
        await expect(page.getByText(variant === 'success' ? copy.successTitle : titleFor(variant), { exact: true })).toBeVisible();
        await expect(submitButton(page)).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(['401', '500', 'network'].includes(variant) ? retryButton(page) : back(page)).toBeFocused();
        await check.assertAccessibility(parity); await check.assertLocale(parity);
      }
      await open(parity, ['500', '500', 'success']); await submit(page);
      await retryButton(page).click(); await expect(retryButton(page)).toBeFocused();
      await expect(page.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
      await retryButton(page).click(); await success(page);
      await expect(submitButton(page)).toBeFocused();
      await check.assertAccessibility(parity);
    });
    test('runtime-health', async ({ parity }) => {
      const page = parity.page;
      for (const variant of ['delivered', 'pending-delivery', '400', '401', '403', '404', '429', '500', 'network']) {
        await open(parity, variant); await submit(page);
        await expect(page.getByText(['delivered', 'pending-delivery'].includes(variant) ? copy.successTitle : titleFor(variant), { exact: true })).toBeVisible();
      }
      await open(parity, '500-then-success'); await submit(page);
      await retryButton(page).click(); await success(page);
      await back(page).click();
      await expect(page.getByRole('heading', { name: loginCopy.title, exact: true })).toBeVisible();
      await page.getByRole('link', { name: loginCopy.labels.passwordRecovery, exact: true }).click();
      await expect(field(page)).toBeFocused();
      await runtimeHealth(parity);
      // Prove that page application errors cannot be hidden by the resource allowance.
      const before = parity.faults.length;
      await page.evaluate(() => console.error('synthetic-recovery-application-error'));
      await expect.poll(() => parity.faults.length).toBeGreaterThan(before);
      await expect(runtimeHealth(parity)).rejects.toThrow(/runtime-health/);
    });
    test('responsive', async ({ parity }) => {
      const page = parity.page;
      for (const variant of ['success', '403', '404', '429', '500']) {
        await open(parity, variant);
        await check.assertResponsive(parity, width);
        await submit(page);
        await expect(page.getByText(variant === 'success' ? copy.successTitle : titleFor(variant), { exact: true })).toBeVisible();
        await check.assertResponsive(parity, width);
        const form = await page.locator('form').boundingBox();
        if (width === 375) {
          // Input's inner editing area excludes the kit wrapper's border and padding.
          const control = await submitButton(page).boundingBox();
          expect(Math.abs(control.width - form.width)).toBeLessThanOrEqual(1);
          if (variant === '500') {
            const retry = await retryButton(page).boundingBox();
            const actions = await retryButton(page).locator('..').boundingBox();
            expect(Math.abs(retry.width - actions.width)).toBeLessThanOrEqual(1);
            const copyControl = await page.getByRole('button', { name: copy.copyRequestId, exact: true }).boundingBox();
            expect(Math.abs(copyControl.width - copyControl.height)).toBeLessThanOrEqual(1);
          }
        }
        const aside = await page.getByRole('region', { name: copy.asideTitle, exact: true }).boundingBox();
        expect(aside.y).toBeGreaterThanOrEqual(form.y + form.height);
      }
    });
    test('visual-review', async ({ parity }, info) => {
      const page = parity.page;
      await open(parity); await capture(page, info, 'initial');
      await holdRequest(page, () => submit(page), async () => {
        await expect(page.getByRole('button', { name: copy.submitting, exact: true })).toBeDisabled();
        await capture(page, info, 'pending');
      });
      await success(page); await capture(page, info, 'success');
      for (const [state, variant] of [['403', '403'], ['404', '404'], ['429', '429'], ['service-error', '500']]) {
        await open(parity, variant); await submit(page);
        await expect(page.getByText(titleFor(variant), { exact: true })).toBeVisible();
        await check.assertLocale(parity); await capture(page, info, state);
      }
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
  });
}
