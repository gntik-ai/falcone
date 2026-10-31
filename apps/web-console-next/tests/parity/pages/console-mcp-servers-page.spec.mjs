import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { listPath } from './console-mcp-servers-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';

const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale,
  JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-mcp-servers-page.json`, import.meta.url), 'utf8')),
]));
const surface = (parity) => parity.page.getByTestId('console-mcp-servers-page');
const copy = (parity) => bundles[parity.locale];
const calls = (parity) => parity.network.requests.filter(({ path }) => path === listPath);
async function ready(parity) { await expect(surface(parity).getByRole('link', { name: 'Acme Orders', exact: true })).toBeVisible(); }
async function nav(parity, width) {
  if (width < 1024) {
    await parity.page.getByRole('button', { name: parity.locale === 'es' ? 'Abrir navegación' : 'Open navigation', exact: true }).last().click();
    return parity.page.getByRole('dialog').getByRole('link', { name: copy(parity).title, exact: true });
  }
  return parity.page.getByRole('navigation', { name: parity.locale === 'es' ? 'Navegación de consola' : 'Console navigation', exact: true }).getByRole('link', { name: copy(parity).title, exact: true });
}
for (const role of manifest.roles) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-mcp-servers-page | ${role} | ${locale} | ${width}`, () => {
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test.beforeEach(async ({ parity }) => {
      const injected = [];
      parity.page.on('response', (response) => {
        if (new URL(response.url()).pathname === listPath && response.status() >= 400) injected.push({ url: response.url(), kind: String(response.status()) });
      });
      parity.page.on('requestfailed', (request) => {
        if (new URL(request.url()).pathname === listPath) injected.push({ url: request.url(), kind: 'network' });
      });
      parity.page.on('console', (message) => {
        if (message.type() !== 'error' || !consumeResourceDiagnostic(message.text(), message.location().url, injected)) return;
        const index = parity.faults.indexOf(`console.error: ${message.text()}`);
        if (index >= 0) parity.faults.splice(index, 1);
      });
    });
    test('data', async ({ parity }) => {
      await parity.open(manifest.route); await ready(parity);
      await expect(surface(parity).getByRole('row')).toHaveCount(3);
      await expect(surface(parity).getByRole('link', { name: 'srv_2', exact: true })).toBeVisible();
      await expect(surface(parity).getByText(copy(parity).statuses.published, { exact: true })).toBeVisible();
      await expect(surface(parity).getByText(copy(parity).statuses.draft, { exact: true })).toBeVisible();
      expect(calls(parity)).toEqual([{ method: 'GET', path: listPath, body: undefined }]);
      await expect(await nav(parity, width)).toHaveAttribute('aria-current', 'page');
      await check.assertLocale(parity);
    });
    test('action', async ({ parity }) => {
      await parity.open(manifest.route); await ready(parity);
      let documents = 0;
      parity.page.on('request', (request) => { if (request.isNavigationRequest() && request.frame() === parity.page.mainFrame()) documents++; });
      await surface(parity).getByRole('link', { name: 'Acme Orders', exact: true }).click();
      await expect(parity.page.getByTestId('mcp-server-detail')).toBeVisible();
      expect(documents).toBe(0);
      const entry = await nav(parity, width);
      await expect(entry).toHaveAttribute('aria-current', 'page');
      await entry.click(); await ready(parity);
      expect(documents).toBe(0);
      expect(calls(parity)).toHaveLength(2);
    });
    test('error-empty', async ({ parity }) => {
      for (const variant of ['empty', '403', '404', '500', 'network', '401']) {
        await parity.open(manifest.route, { 'mcp.list': variant });
        const key = variant === 'empty' ? 'empty' : variant === '403' ? 'noAccess' : variant === '404' ? 'unavailable' : 'errorTitle';
        await expect(surface(parity).getByRole('heading', { name: copy(parity)[key], exact: true })).toBeVisible();
        await expect(surface(parity).getByRole('table')).toHaveCount(0);
        if (variant === 'empty' || variant === '403' || variant === '404') await expect(surface(parity).getByRole('button', { name: copy(parity).retry, exact: true })).toHaveCount(0);
        if (variant === '401') {
          await expect(surface(parity).getByText(copy(parity).errors['401'], { exact: true })).toBeVisible();
          expect(new URL(parity.page.url()).pathname).toMatch(/\/console\/mcp\/servers$/);
          expect(await parity.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-shell-session')))).not.toBeNull();
          expect(parity.network.requests.filter(({ path }) => path.endsWith('/refresh'))).toHaveLength(1);
        }
        await check.assertLocale(parity); await check.assertAccessibility(parity);
        if (variant === '500' || variant === 'network') {
          const before = calls(parity).length;
          parity.network.setVariants({ 'mcp.list': 'success' });
          await surface(parity).getByRole('button', { name: copy(parity).retry, exact: true }).click(); await ready(parity);
          expect(calls(parity)).toHaveLength(before + 1);
        }
      }
      const before = calls(parity).length;
      await parity.open(manifest.route, { workspaces: 'empty' });
      await expect(surface(parity).getByRole('heading', { name: copy(parity).workspaceRequired, exact: true })).toBeVisible();
      expect(calls(parity)).toHaveLength(before);
      await check.assertAccessibility(parity);
    });
    test('accessibility', async ({ parity }) => {
      await parity.open(manifest.route); await ready(parity); await check.assertAccessibility(parity);
      const link = surface(parity).getByRole('link', { name: 'Acme Orders', exact: true });
      await link.focus(); await expect(link).toBeFocused(); await parity.page.keyboard.press('Enter');
      await expect(parity.page.getByTestId('mcp-server-detail')).toBeVisible();
    });
    test('runtime-health', async ({ parity }) => {
      await parity.open(manifest.route); await ready(parity); await check.assertRuntimeHealth(parity);
    });
    test('responsive', async ({ parity }) => {
      await parity.open(manifest.route); await ready(parity); await check.assertResponsive(parity, width);
    });
    test('visual-review', async ({ parity }, info) => {
      for (const variant of ['success', 'empty', '403', '404', '500']) {
        await parity.open(manifest.route, { 'mcp.list': variant });
        if (variant === 'success') await ready(parity);
        else await expect(surface(parity).getByRole('heading', { level: 2 })).toBeVisible();
        await check.assertLocale(parity);
        const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
        await info.attach(`${variant}-${locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
      }
    });
    test('kit-conformance', async ({ parity }) => {
      await parity.open(manifest.route); await ready(parity); await check.kitConformance(manifest); await check.assertLocale(parity);
    });
  });
}
