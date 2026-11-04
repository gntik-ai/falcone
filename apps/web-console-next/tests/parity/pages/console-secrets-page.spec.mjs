import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { boundTenantId, inventoryFixtures, platformGet, platformRow, revokePath, tenantGet, tenantRow } from './console-secrets-page.manifest.ts';
import { seedHistoryPrincipal } from './console-flow-history-page.session.mjs';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';

const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-secrets-page.json`, import.meta.url), 'utf8'))]));
const copy = (parity) => bundles[parity.locale];
const surface = (parity) => parity.page.getByTestId('console-secrets-page');
const dialog = (parity) => parity.page.getByRole('alertdialog');
const named = (text, name) => text.replace('{name}', name);
const revoke = (parity, name = tenantRow.name) => surface(parity).getByRole('button', { name: named(copy(parity).revokeNamed, name), exact: true });
const posts = (parity) => parity.network.requests.filter(({ method, path }) => method === 'POST' && /\/revoke$/.test(path));
const reads = (parity) => parity.network.requests.filter(({ method, path }) => method === 'GET' && path.startsWith('/v1/secrets/inventory'));
const ready = (parity) => expect(surface(parity).getByRole('table', { name: copy(parity).table })).toBeVisible();
async function openDialog(parity, name = tenantRow.name) { await ready(parity); await revoke(parity, name).click(); await expect(dialog(parity)).toBeVisible(); }
async function typeName(parity, name = tenantRow.name) { await dialog(parity).getByRole('textbox', { name: copy(parity).typedName, exact: true }).fill(name); }
async function confirm(parity) { await dialog(parity).getByRole('button', { name: copy(parity).confirm, exact: true }).click(); }
async function assertLocale(parity) {
  const c = copy(parity), other = bundles[parity.locale === 'es' ? 'en' : 'es'];
  await expect(parity.page.locator('html')).toHaveAttribute('lang', parity.locale);
  const scopes = [surface(parity), dialog(parity)];
  for (const scope of scopes) {
    if (!await scope.count()) continue;
    const values = await scope.evaluate((root) => [...root.querySelectorAll('*')].flatMap((node) => [node.textContent?.trim(), ...['aria-label', 'title', 'placeholder'].map((key) => node.getAttribute(key))]).filter(Boolean));
    const forbidden = Object.keys(c).filter((key) => typeof c[key] === 'string' && c[key] !== other[key] && !other[key].includes('{')).map((key) => other[key]);
    expect(values.filter((value) => forbidden.includes(value) || value.includes('pages.console-secrets-page.'))).toEqual([]);
  }
}
async function screenshot(parity, info, name) {
  const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
  await info.attach(`${name}-${parity.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}

for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-secrets-page | ${locale} | ${width}`, () => {
    test.use({ role: 'superadmin', locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    let choices, attempts, unmatched, allowRefresh;
    async function open(parity, variants = {}, platform = 'platform-secrets-static-inventory', tenant = platform) {
      choices = { platform, tenant }; attempts = { platform: 0, tenant: 0 }; allowRefresh = variants.revokeTenant === 'secret-revoke-401';
      await parity.open(manifest.route, variants);
    }
    test.beforeEach(async ({ parity }) => {
      choices = { platform: 'platform-secrets-static-inventory', tenant: 'platform-secrets-static-inventory' }; attempts = { platform: 0, tenant: 0 }; unmatched = [];
      await parity.page.addInitScript(seedHistoryPrincipal, { tenantIds: [boundTenantId], workspaceIds: [] });
      const failures = [];
      const scoped = (url) => /\/v1\/(?:secrets\/inventory|platform\/secrets\/)/.test(new URL(url).pathname);
      parity.page.on('response', (response) => { if (scoped(response.url()) && response.status() >= 400) failures.push({ url: response.url(), kind: String(response.status()) }); });
      parity.page.on('requestfailed', (request) => { if (scoped(request.url())) failures.push({ url: request.url(), kind: 'network' }); });
      parity.page.on('console', (message) => {
        if (message.type() !== 'error') return;
        let consumed = consumeResourceDiagnostic(message.text(), message.location().url, failures);
        if (!consumed && /^Failed to load resource: the server responded with a status of 503(?: \([^\n]*\))?$/.test(message.text())) {
          const index = failures.findIndex((failure) => failure.url === message.location().url && failure.kind === '503');
          if (index >= 0) { failures.splice(index, 1); consumed = true; }
        }
        if (!consumed) return;
        const index = parity.faults.indexOf(`console.error: ${message.text()}`); if (index >= 0) parity.faults.splice(index, 1);
      });
      // The shared endpoint registry matches pathnames; page-local inventory handling also
      // enforces the exact domain and tenant query, and rejects limit/offset or extra keys.
      await parity.page.route('**/v1/secrets/inventory?*', async (route) => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname + url.search;
        if (request.method() !== 'GET' || ![platformGet, tenantGet].includes(path)) { unmatched.push(`${request.method()} ${path}`); await route.abort(); return; }
        parity.network.requests.push({ method: 'GET', path, body: undefined });
        const domain = url.searchParams.get('domain'), sequence = choices[domain];
        const choice = Array.isArray(sequence) ? sequence[Math.min(attempts[domain]++, sequence.length - 1)] : sequence;
        const response = inventoryFixtures(domain === 'platform' ? platformRow : tenantRow)[choice];
        if (!response) throw new Error(`Unknown inventory fixture ${choice}`);
        if (response.delayMs) await new Promise((done) => setTimeout(done, response.delayMs));
        if (response.network) await route.abort('failed'); else await route.fulfill({ status: response.status ?? 200, json: response.body });
      });
    });
    test.afterEach(async ({ parity }) => {
      expect(unmatched).toEqual([]);
      const allowed = new Set([platformGet, tenantGet, revokePath(platformRow), revokePath(tenantRow), '/v1/tenants?page%5Bsize%5D=100&sort=displayName', ...(allowRefresh ? ['/v1/auth/login-sessions/synthetic-session/refresh', '/v1/auth/signups/policy'] : [])]);
      expect(parity.network.requests.filter(({ path }) => !allowed.has(path))).toEqual([]);
      await check.assertRuntimeHealth(parity);
    });
    test('data', async ({ parity }) => {
      const c = copy(parity); await open(parity); await ready(parity);
      await expect(surface(parity).getByRole('heading', { name: c.title, level: 1 })).toBeVisible();
      await expect(surface(parity).getByText(c.states.active, { exact: true })).toBeVisible(); await expect(surface(parity).getByText(c.states.grace, { exact: true })).toBeVisible();
      await expect(surface(parity).getByText(c.returnedRows, { exact: true })).toBeVisible();
      expect(reads(parity)).toEqual([{ method: 'GET', path: platformGet, body: undefined }, { method: 'GET', path: tenantGet, body: undefined }]);
      await assertLocale(parity);
      await open(parity, {}, '50-rows'); await ready(parity);
      await expect(surface(parity).getByRole('row')).toHaveCount(101);
      await expect(surface(parity).getByText(locale === 'es' ? '100 secretos' : '100 secrets', { exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('navigation')).toHaveCount(0);
      await expect(surface(parity).getByRole('searchbox')).toHaveCount(0);
    });
    test('action', async ({ parity }) => {
      const c = copy(parity); await open(parity); await openDialog(parity);
      await expect(dialog(parity).getByRole('button', { name: c.confirm, exact: true })).toBeDisabled();
      await typeName(parity, 'DB-PASSWORD'); await expect(dialog(parity).getByRole('button', { name: c.confirm, exact: true })).toBeDisabled();
      await expect(dialog(parity).getByRole('checkbox', { name: c.force })).toBeChecked(); await expect(dialog(parity).getByText(c.lastVersionWarning)).toBeVisible();
      await dialog(parity).getByRole('button', { name: c.cancel, exact: true }).click(); await expect(revoke(parity)).toBeFocused(); expect(posts(parity)).toHaveLength(0);
      await openDialog(parity); await typeName(parity);
      await dialog(parity).getByRole('textbox', { name: c.justification, exact: true }).fill('synthetic reason'); await confirm(parity); await expect(dialog(parity)).toHaveCount(0);
      expect(posts(parity)).toEqual([{ method: 'POST', path: revokePath(tenantRow), body: { justification: 'synthetic reason', forceRevoke: true } }]); expect(reads(parity)).toHaveLength(2);
      await expect(parity.page.getByText(c.revoked.replace('{name}', tenantRow.name).replace('{version}', '1'), { exact: true }).first()).toBeVisible();
      await openDialog(parity, platformRow.name); await expect(dialog(parity).getByRole('checkbox')).not.toBeChecked(); await typeName(parity, platformRow.name); await confirm(parity); await expect(dialog(parity)).toHaveCount(0);
      expect(posts(parity).at(-1)).toEqual({ method: 'POST', path: revokePath(platformRow), body: { justification: '', forceRevoke: false } });
      const href = '/console/secrets/tenant%2Ftenant-a%2Fdb-password/rotate';
      for (const key of ['rotateNamed', 'historyNamed']) await expect(surface(parity).getByRole('link', { name: named(c[key], tenantRow.name), exact: true })).toHaveAttribute('href', href);
      await parity.page.route('**/console/secrets/*/rotate', (route) => route.fulfill({ contentType: 'text/html', body: '<main>synthetic-legacy-rotation</main>' }));
      await surface(parity).getByRole('link', { name: named(c.rotateNamed, tenantRow.name), exact: true }).click(); await expect(parity.page).toHaveURL(new RegExp(`${href}$`));
    });
    test('error-empty', async ({ parity, server }) => {
      const c = copy(parity);
      const loading = open(parity, {}, 'platform-secrets-loading-delayed'); await expect(parity.page.getByRole('status', { name: c.loading })).toBeVisible(); await loading; await ready(parity);
      await open(parity, {}, 'platform-secrets-empty'); await expect(surface(parity).getByRole('heading', { name: c.empty })).toBeVisible(); await expect(surface(parity).getByRole('table')).toHaveCount(0);
      for (const variant of ['unbound', 'null-version']) {
        await open(parity, {}, variant); await ready(parity); await expect(revoke(parity)).toBeDisabled(); await expect(revoke(parity, platformRow.name)).toBeDisabled(); await expect(dialog(parity)).toHaveCount(0);
        if (variant === 'null-version') await expect(surface(parity).locator('time')).toHaveCount(0);
      }
      for (const [platform, tenant, heading] of [['403', '404', 'noAccess'], ['404', '403', 'noAccess'], ['500', '403', 'inventoryError'], ['404', '404', 'notFound'], ['network', '404', 'inventoryError']]) {
        await open(parity, {}, platform, tenant); await expect(surface(parity).getByRole('heading', { name: c[heading], exact: true })).toBeVisible(); await expect(surface(parity).getByRole('table')).toHaveCount(0);
      }
      await open(parity, {}, ['500', 'platform-secrets-static-inventory'], ['platform-secrets-static-inventory', 'platform-secrets-static-inventory']);
      await expect(surface(parity).getByRole('heading', { name: c.inventoryError })).toBeVisible(); const count = reads(parity).length;
      await surface(parity).getByRole('button', { name: c.retry, exact: true }).click(); await ready(parity); expect(reads(parity)).toHaveLength(count + 2);
      await expect(surface(parity).locator('[role="region"][tabindex="-1"]')).toBeFocused();
      await open(parity, {}, ['500', '500']);
      await expect(surface(parity).getByRole('heading', { name: c.inventoryError })).toBeVisible();
      const beforeFailedRetry = reads(parity).length;
      await surface(parity).getByRole('button', { name: c.retry, exact: true }).click();
      await expect.poll(() => reads(parity).length).toBe(beforeFailedRetry + 2);
      await expect(surface(parity).getByRole('button', { name: c.retry, exact: true })).toBeFocused();
      for (const variant of ['secret-revoke-403', 'secret-revoke-404-not-found']) {
        await open(parity, { revokeTenant: variant }); await openDialog(parity); await typeName(parity); await confirm(parity);
        const notFound = variant.includes('404'); await expect(dialog(parity).getByRole('heading', { name: c[notFound ? 'notFound' : 'noAccess'], exact: true })).toBeVisible();
        await check.assertAccessibility(parity); await assertLocale(parity);
        if (notFound) await expect(dialog(parity).getByRole('link', { name: c.viewHistory })).toHaveAttribute('href', '/console/secrets/tenant%2Ftenant-a%2Fdb-password/rotate');
        await dialog(parity).getByRole('button', { name: c[notFound ? 'backInventory' : 'close'], exact: true }).click(); await expect(revoke(parity)).toBeFocused();
      }
      for (const variant of ['secret-revoke-409', 'secret-revoke-500', 'secret-revoke-503', 'secret-revoke-network']) {
        await open(parity, { revokeTenant: [variant, 'secret-revoke-200'] }); await openDialog(parity); await typeName(parity);
        await dialog(parity).getByRole('textbox', { name: c.justification, exact: true }).fill('synthetic reason'); const start = posts(parity).length; await confirm(parity);
        await expect(dialog(parity).getByRole('heading', { name: c.revokeError })).toBeVisible();
        await expect(dialog(parity).getByRole('textbox', { name: c.justification, exact: true })).toHaveValue('synthetic reason');
        await expect(dialog(parity).getByRole('textbox', { name: c.typedName, exact: true })).toHaveValue(tenantRow.name); await expect(dialog(parity).getByRole('checkbox')).toBeChecked();
        await check.assertAccessibility(parity); await assertLocale(parity);
        await dialog(parity).getByRole('button', { name: c.retry, exact: true }).click(); await expect(dialog(parity)).toHaveCount(0);
        expect(posts(parity).slice(start)).toEqual(Array.from({ length: 2 }, () => ({ method: 'POST', path: revokePath(tenantRow), body: { justification: 'synthetic reason', forceRevoke: true } })));
      }
      await open(parity, { revokeTenant: 'secret-revoke-delayed' }); await openDialog(parity); await typeName(parity); const start = posts(parity).length;
      await confirm(parity); await expect(dialog(parity).getByRole('button', { name: c.confirm, exact: true })).toHaveAttribute('aria-busy', 'true');
      await expect(dialog(parity).getByRole('button', { name: c.confirm, exact: true })).toBeDisabled(); await parity.page.keyboard.press('Enter'); await expect(dialog(parity)).toHaveCount(0); expect(posts(parity).slice(start)).toHaveLength(1);
      await open(parity, { revokeTenant: 'secret-revoke-401' }); await openDialog(parity); await typeName(parity); const before = parity.network.requests.length; await confirm(parity);
      await expect(parity.page).toHaveURL(/\/login$/);
      expect(parity.network.requests.slice(before).filter(({ method }) => method === 'POST').map(({ path }) => path)).toEqual([revokePath(tenantRow), '/v1/auth/login-sessions/synthetic-session/refresh']);
      expect(await parity.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(new URL(server.url('console/secrets')).pathname);
    });
    test('accessibility', async ({ parity }) => {
      const c = copy(parity); await open(parity); await ready(parity); await check.assertAccessibility(parity); await assertLocale(parity);
      await revoke(parity).focus(); await parity.page.keyboard.press('Enter'); await expect(dialog(parity).getByRole('textbox', { name: c.typedName, exact: true })).toBeFocused();
      await typeName(parity, 'wrong'); await expect(dialog(parity).getByText(named(c.nameMismatch, tenantRow.name))).toBeVisible(); await check.assertAccessibility(parity); await assertLocale(parity);
      await parity.page.keyboard.press('Escape'); await expect(dialog(parity)).toHaveCount(0); await expect(revoke(parity)).toBeFocused(); expect(posts(parity)).toHaveLength(0);
    });
    test('runtime-health', async ({ parity }) => {
      await open(parity, { revokeTenant: 'secret-revoke-404-not-found' }); await openDialog(parity); await typeName(parity); await confirm(parity);
      await expect(dialog(parity).getByRole('heading', { name: copy(parity).notFound })).toBeVisible(); await check.assertRuntimeHealth(parity);
    });
    test('responsive', async ({ parity }) => {
      await open(parity); await ready(parity); await check.assertResponsive(parity, width); await openDialog(parity); await check.assertResponsive(parity, width);
      await expect(dialog(parity).getByRole('button', { name: copy(parity).confirm, exact: true })).toBeVisible();
      await expect(dialog(parity).getByRole('button', { name: copy(parity).cancel, exact: true })).toBeVisible();
    });
    test('visual-review', async ({ parity }, info) => {
      await open(parity); await ready(parity); await assertLocale(parity); await screenshot(parity, info, 'platform-secrets-static-inventory');
      await openDialog(parity); await assertLocale(parity); await screenshot(parity, info, 'confirmation-with-force');
      for (const variant of ['secret-revoke-403', 'secret-revoke-404-not-found', 'secret-revoke-500']) {
        await open(parity, { revokeTenant: variant }); await openDialog(parity); await typeName(parity); await confirm(parity);
        await expect(dialog(parity).getByRole('heading', { name: copy(parity)[variant.endsWith('403') ? 'noAccess' : variant.endsWith('not-found') ? 'notFound' : 'revokeError'] })).toBeVisible();
        await assertLocale(parity); await screenshot(parity, info, variant);
      }
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
  });
}
