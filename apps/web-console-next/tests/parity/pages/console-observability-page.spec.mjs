import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import manifest, { overviewMixed } from './console-observability-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';

const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-observability-page.json`, import.meta.url), 'utf8'))]));
const build = JSON.parse(readFileSync(new URL('../../../dist/.vite/manifest.json', import.meta.url), 'utf8'));
const entry = Object.values(build).find((chunk) => chunk.isEntry && chunk.name === 'app').file;
const surface = (parity) => parity.page.locator('.console-observability');
const dialog = (parity) => parity.page.locator('[role="dialog"]');
const audit = 'page%5Bsize%5D=50&sort=-eventTimestamp';
const workspace = '/v1/metrics/workspaces/synthetic-workspace';
const tenant = '/v1/metrics/tenants/synthetic-tenant';
const metricsRequests = (parity) => parity.network.requests.filter((request) => request.path.startsWith('/v1/metrics/'));
const lines = (parity, from = 0) => parity.network.requests.slice(from).filter((request) => request.path.startsWith('/v1/metrics/')).map((request) => `${request.method} ${request.path}`);
async function open(parity, variants = {}) {
  await parity.open(manifest.route, variants);
  await expect(surface(parity)).toBeVisible();
  await expect(surface(parity).locator('[aria-busy="true"]')).toHaveCount(0);
}
async function openAudit(parity, copy, variants = {}) {
  await open(parity, variants);
  await surface(parity).getByRole('tab', { name: copy.tabAudit, exact: true }).click();
}
// Every request is a page-list endpoint, a shell bootstrap request, or the refresh POST in 401 fixtures.
function allowlist(parity) {
  for (const request of parity.network.requests) {
    const url = new URL(request.path, 'http://synthetic.test');
    const metrics = /^\/v1\/metrics\/(?:tenants\/synthetic-tenant|workspaces\/synthetic-workspace)\/(overview|usage|series|audit-records|audit-exports)$/.exec(url.pathname);
    const shellRead = /^\/v1\/(?:tenants(?:\/synthetic-tenant)?|workspaces|auth\/signups\/policy)$/;
    const refresh = /^\/v1\/auth\/login-sessions\/synthetic-session\/refresh$/;
    if (metrics) {
      const [, kind] = metrics;
      expect(url.pathname, 'GET tenants series is never sent').not.toBe(`${tenant}/series`);
      if (kind === 'audit-exports') {
        expect(request.method).toBe('POST');
        expect(Object.keys(request.body)).toEqual(['filters']);
      } else {
        expect(request.method).toBe('GET');
        expect(request.body).toBeUndefined();
        if (kind === 'overview' || kind === 'usage') expect(url.search).toBe('');
        if (kind === 'series') expect(url.search).toMatch(/^\?metricKey=api_requests&window=(?:24h|7d|30d)$/);
        if (kind === 'audit-records') {
          expect(url.search.startsWith(`?${audit}`)).toBe(true);
          for (const key of url.searchParams.keys()) expect(['page[size]', 'sort', 'page[after]', 'filter[actorId]', 'filter[actionCategory]', 'filter[outcome]', 'filter[occurredAfter]', 'filter[occurredBefore]']).toContain(key);
        }
      }
    } else if (request.method === 'GET') expect(shellRead.test(url.pathname), `${request.method} ${url.pathname}`).toBe(true);
    else {
      expect(request.method).toBe('POST'); expect(url.pathname).toMatch(refresh);
      expect(request.body).toEqual({ refreshToken: 'synthetic-refresh-token' });
    }
  }
}
// Change only synthetic session roles before the entry chunk executes; the shared Role union stays untouched.
async function withRole(parity, server, roles, variants = {}) {
  const seed = async (route) => {
    await parity.page.evaluate((roles) => {
      const session = JSON.parse(sessionStorage.getItem('in-falcone.console-shell-session'));
      session.principal.platformRoles = roles;
      sessionStorage.setItem('in-falcone.console-shell-session', JSON.stringify(session));
    }, roles);
    await route.fallback();
  };
  parity.network.setVariants(variants);
  await parity.page.route(`**/${entry}`, seed);
  try { await parity.page.goto(server.url('console/observability')); }
  finally { await parity.page.unroute(`**/${entry}`, seed); }
  await expect(surface(parity)).toBeVisible();
}
async function keyboardActivate(page, target) {
  await page.evaluate(() => document.activeElement?.blur());
  for (let index = 0; index < 120; index++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((node) => node === document.activeElement)) { await page.keyboard.press('Enter'); return; }
  }
  throw new Error('Action is not reachable by keyboard');
}
const exportButton = (parity, copy) => surface(parity).getByRole('button', { name: copy.export.button, exact: true });

for (const role of manifest.roles) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-observability-page | ${role} | ${locale} | ${width}`, () => {
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    const copy = bundles[locale];
    // The shared harness only recognizes injected failures for selected endpoint families. The metrics fixtures
    // inject exact status codes, so the browser's resource diagnostic for those URLs is expected; any other console
    // error, page error or rejection stays a fault.
    test.beforeEach(async ({ parity }) => {
      const injected = [];
      const scoped = (url) => new URL(url).pathname.startsWith('/v1/metrics/');
      parity.page.on('response', (response) => { if (scoped(response.url()) && response.status() >= 400) injected.push({ url: response.url(), kind: String(response.status()) }); });
      parity.page.on('requestfailed', (request) => { if (scoped(request.url())) injected.push({ url: request.url(), kind: 'network' }); });
      parity.page.on('console', (message) => {
        if (message.type() !== 'error' || !consumeResourceDiagnostic(message.text(), message.location().url, injected)) return;
        const index = parity.faults.indexOf(`console.error: ${message.text()}`);
        if (index >= 0) parity.faults.splice(index, 1);
      });
    });
    test.afterEach(async ({ parity }) => { allowlist(parity); });
    test('data', async ({ parity }) => {
      await open(parity);
      await expect.poll(() => lines(parity).length).toBe(4);
      expect(lines(parity).sort()).toEqual([`GET ${workspace}/audit-records?${audit}`, `GET ${workspace}/overview`, `GET ${workspace}/series?metricKey=api_requests&window=24h`, `GET ${workspace}/usage`].sort());
      for (const row of overviewMixed.dimensions) await expect(surface(parity).getByRole('heading', { name: row.displayName, level: 3 })).toBeVisible();
      await expect(surface(parity).getByRole('meter')).toHaveCount(5);
      await expect(surface(parity).getByRole('meter', { name: locale === 'es' ? 'Uso de Synthetic Requests' : 'Usage of Synthetic Requests' })).toHaveAttribute('aria-valuetext', locale === 'es' ? '110% usado' : '110% used');
      await expect(surface(parity).getByText(copy.metrics.exceeded, { exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('link', { name: copy.metrics.quotasLink })).toHaveAttribute('href', /\/console\/quotas$/);
      await expect(surface(parity).getByText(copy.metrics.unlimited, { exact: true })).toBeVisible();
      await expect(surface(parity).getByText(copy.metrics.notEnforced, { exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('link', { name: copy.postureLink.replace('{label}', copy.posture.hard_limit_breached) })).toBeVisible();
      await expect(surface(parity).locator('time').first()).toHaveText(new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(overviewMixed.generatedAt)));
      // Exactly one series variant renders and no range toggle (90d or otherwise) exists.
      await expect(surface(parity).getByRole('heading', { name: copy.series.title, level: 2 })).toBeVisible();
      await expect(surface(parity).getByText(new RegExp(copy.series.summary.split('{latest}')[0]))).toBeVisible();
      await expect(surface(parity).getByRole('button', { name: /90/ })).toHaveCount(0);
      await expect(surface(parity).getByRole('radio')).toHaveCount(0);
      await expect(surface(parity)).not.toContainText(/Infrastructure cost|Compute|Spend by resource/);
      await check.assertLocale(parity);
      await surface(parity).getByRole('tab', { name: copy.tabAudit, exact: true }).click();
      await expect(surface(parity).getByRole('button', { name: /^evt-\d{3}$/ })).toHaveCount(50);
      await expect(surface(parity).getByText(locale === 'es' ? '50 eventos mostrados' : '50 events shown', { exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('button', { name: copy.audit.loadMore, exact: true })).toBeVisible();
      const trigger = surface(parity).getByRole('button', { name: 'evt-001', exact: true });
      await trigger.click();
      await expect(dialog(parity)).toContainText('synthetic-evt-001');
      await expect(dialog(parity)).toContainText('Synthetic Actor (user)');
      await check.assertLocale(parity);
      await dialog(parity).getByRole('button', { name: copy.detail.close, exact: true }).click();
      await expect(dialog(parity)).toHaveCount(0);
      await expect(trigger).toBeFocused();
      allowlist(parity);
    });
    test('action', async ({ parity }) => {
      // Window 7d refetches overview, usage and series; the audit read is not repeated.
      await open(parity);
      const start = parity.network.requests.length;
      await surface(parity).getByRole('combobox', { name: copy.metrics.windowLabel, exact: true }).click();
      await parity.page.getByRole('option', { name: '7d', exact: true }).click();
      await expect.poll(() => lines(parity, start).length).toBe(3);
      expect(lines(parity, start).sort()).toEqual([`GET ${workspace}/overview`, `GET ${workspace}/series?metricKey=api_requests&window=7d`, `GET ${workspace}/usage`].sort());
      // Audit filters restart from the first page with the legacy parameters.
      await open(parity, { 'metrics.workspace.records': 'filtered' });
      await surface(parity).getByRole('tab', { name: copy.tabAudit, exact: true }).click();
      const mark = parity.network.requests.length;
      const actor = surface(parity).getByRole('searchbox', { name: copy.audit.actor, exact: true });
      await actor.fill('ana');
      await expect(actor).toBeFocused();
      await expect(surface(parity).getByRole('button', { name: 'evt-900', exact: true })).toBeVisible();
      await surface(parity).getByRole('textbox', { name: copy.audit.category, exact: true }).fill('iam');
      await surface(parity).getByRole('combobox', { name: copy.audit.result, exact: true }).click();
      await parity.page.getByRole('option', { name: copy.audit.resultFailure, exact: true }).click();
      await expect.poll(() => decodeURIComponent(lines(parity, mark).at(-1) ?? '')).toContain('filter[actorId]=ana&filter[actionCategory]=iam&filter[outcome]=failed');
      // Cargar mas sends the cursor with the same filters, appends and hides itself on the last page.
      await open(parity, { 'metrics.workspace.records': 'first-page-has-more' });
      await surface(parity).getByRole('tab', { name: copy.tabAudit, exact: true }).click();
      const before = parity.network.requests.length;
      await surface(parity).getByRole('button', { name: copy.audit.loadMore, exact: true }).click();
      await expect(surface(parity).getByText(locale === 'es' ? '60 eventos mostrados' : '60 events shown', { exact: true })).toBeVisible();
      expect(lines(parity, before)).toEqual([`GET ${workspace}/audit-records?${audit}&page%5Bafter%5D=synthetic-cursor-2`]);
      await expect(surface(parity).getByRole('button', { name: copy.audit.loadMore, exact: true })).toHaveCount(0);
      await expect(surface(parity).getByRole('button', { name: 'evt-051', exact: true })).toBeFocused();
      // The export POSTs the filter body and offers the manifest as <exportId>.json.
      await open(parity);
      await surface(parity).getByRole('tab', { name: copy.tabAudit, exact: true }).click();
      await exportButton(parity, copy).click();
      await expect(surface(parity).getByText(copy.export.readyTitle, { exact: true })).toBeVisible();
      await expect(surface(parity).getByText('exp-synthetic-1', { exact: true })).toBeVisible();
      const posts = parity.network.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/audit-exports'));
      expect(posts).toEqual([{ method: 'POST', path: `${workspace}/audit-exports`, body: { filters: {} } }]);
      const [file] = await Promise.all([parity.page.waitForEvent('download'), surface(parity).getByRole('button', { name: copy.export.download, exact: true }).click()]);
      expect(file.suggestedFilename()).toBe('exp-synthetic-1.json');
      // An accepted export without a manifest warns and offers no file.
      await openAudit(parity, copy, { 'metrics.workspace.exports': 'accepted-no-manifest' });
      await exportButton(parity, copy).click();
      await expect(surface(parity).getByText(copy.export.unavailableTitle, { exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('button', { name: copy.export.download })).toHaveCount(0);
      // A failed export keeps the filters, offers no file, and Reintentar re-POSTs the identical body.
      for (const variant of ['500-then-success', 'network-then-success']) {
        await openAudit(parity, copy, { 'metrics.workspace.exports': variant });
        await surface(parity).getByRole('searchbox', { name: copy.audit.actor, exact: true }).fill('ana');
        const sent = parity.network.requests.length;
        await exportButton(parity, copy).click();
        await expect(surface(parity).getByRole('heading', { name: copy.export.errorTitle, level: 2 })).toBeVisible();
        await expect(surface(parity).getByRole('button', { name: copy.export.download })).toHaveCount(0);
        await expect(surface(parity).getByText(copy.export.readyTitle)).toHaveCount(0);
        if (variant.startsWith('500')) await expect(surface(parity).getByText('req_synthetic_observability_500', { exact: true })).toBeVisible();
        await surface(parity).getByRole('searchbox', { name: copy.audit.actor, exact: true }).fill('anabel');
        await surface(parity).getByRole('button', { name: copy.export.retry, exact: true }).click();
        await expect(surface(parity).getByText(copy.export.readyTitle, { exact: true })).toBeVisible();
        const exportsSent = parity.network.requests.slice(sent).filter((request) => request.method === 'POST' && request.path.endsWith('/audit-exports'));
        expect(exportsSent).toHaveLength(2);
        expect(exportsSent[1].body).toEqual(exportsSent[0].body);
        expect(exportsSent[0].body).toEqual({ filters: { actorId: 'ana' } });
      }
      // Tenant scope: tenant endpoints, no series, no window.
      const tenantFrom = parity.network.requests.length;
      await open(parity, { workspaces: 'empty' });
      expect(lines(parity, tenantFrom).filter((line) => line.includes('/series'))).toEqual([]);
      expect(lines(parity, tenantFrom).filter((line) => line.includes('/tenants/synthetic-tenant/')).sort()).toEqual([`GET ${tenant}/audit-records?${audit}`, `GET ${tenant}/overview`, `GET ${tenant}/usage`].sort());
      await open(parity, { workspaces: 'empty', 'metrics.tenant.overview': '500-then-success' });
      const retryFrom = parity.network.requests.length;
      await surface(parity).getByRole('button', { name: copy.error.retry, exact: true }).click();
      await expect(surface(parity).getByRole('heading', { name: 'Synthetic API Keys', level: 3 })).toBeVisible();
      expect(lines(parity, retryFrom).sort()).toEqual([`GET ${tenant}/overview`, `GET ${tenant}/usage`]);
      // Metrics Reintentar at workspace scope re-sends the failed GETs and renders recovered data.
      await open(parity, { 'metrics.workspace.overview': '500-then-success' });
      await surface(parity).getByRole('button', { name: copy.error.retry, exact: true }).click();
      await expect(surface(parity).getByRole('heading', { name: 'Synthetic API Keys', level: 3 })).toBeVisible();
      // Audit Reintentar re-issues the failed first page.
      await openAudit(parity, copy, { 'metrics.workspace.records': '500-then-success' });
      await surface(parity).getByRole('button', { name: copy.error.retry, exact: true }).click();
      await expect(surface(parity).getByRole('button', { name: 'evt-001', exact: true })).toBeVisible();
      allowlist(parity);
    });
    test('error-empty', async ({ parity, server }) => {
      for (const state of manifest.states) {
        await open(parity, { [state.fixture]: state.variant });
        await expect(parity.page.locator(typeof state.locator === 'string' ? state.locator : state.locator[locale])).toBeVisible();
        if (['403', '404', '500', 'network'].includes(state.variant)) await expect(surface(parity).getByRole('meter')).toHaveCount(0);
        if (state.variant === '500') await expect(surface(parity).getByText('req_synthetic_observability_500', { exact: true })).toBeVisible();
        if (state.variant === '404') await expect(surface(parity).getByRole('link', { name: copy.backToOverview })).toHaveAttribute('href', /\/console\/overview$/);
      }
      // series:empty with usage points renders the points; with none it shows the empty copy.
      await open(parity, { 'metrics.workspace.series': 'empty', 'metrics.workspace.usage': 'with-points' });
      await expect(surface(parity).getByText(copy.series.empty, { exact: true })).toHaveCount(0);
      await open(parity, { 'metrics.workspace.series': 'empty' });
      await expect(surface(parity).getByText(copy.series.empty, { exact: true })).toBeVisible();
      // Tenant scope disables the window select and links its reason.
      await open(parity, { workspaces: 'empty' });
      const select = surface(parity).getByRole('combobox', { name: copy.metrics.windowLabel, exact: true });
      await expect(select).toBeDisabled();
      await expect(select).toContainText(copy.metrics.windowNone);
      const describedBy = await select.getAttribute('aria-describedby');
      await expect(parity.page.locator(`[id="${describedBy}"]`)).toHaveText(copy.metrics.windowReason);
      // No tenant: blocked.
      await open(parity, { tenants: 'empty' });
      await expect(surface(parity).getByRole('heading', { name: copy.blocked, level: 2 })).toBeVisible();
      // Audit states: empty with clear filters, 403, 404, network, next-page failures keeping loaded rows.
      await openAudit(parity, copy, { 'metrics.workspace.records': 'empty' });
      await expect(surface(parity).getByRole('heading', { name: copy.audit.empty, level: 2 })).toBeVisible();
      for (const [variant, heading] of [['403', copy.audit.noAccess], ['404', copy.audit.notFound], ['500', copy.audit.errorTitle], ['network', copy.audit.errorTitle]]) {
        await openAudit(parity, copy, { 'metrics.workspace.records': variant });
        await expect(surface(parity).getByRole('heading', { name: heading, level: 2 })).toBeVisible();
        await expect(surface(parity).getByRole('button', { name: /^evt-/ })).toHaveCount(0);
        await expect(surface(parity).getByRole('tab', { name: copy.tabMetrics, exact: true })).toBeVisible();
      }
      for (const variant of ['next-page-500', 'next-page-network']) {
        await openAudit(parity, copy, { 'metrics.workspace.records': variant });
        await surface(parity).getByRole('button', { name: copy.audit.loadMore, exact: true }).click();
        const group = surface(parity).getByRole('group', { name: copy.audit.moreGroup });
        await expect(group.getByRole('button', { name: copy.audit.retry, exact: true })).toBeVisible();
        await expect(surface(parity).getByRole('button', { name: /^evt-\d{3}$/ })).toHaveCount(50);
        await group.getByRole('button', { name: copy.audit.retry, exact: true }).click();
        await expect(surface(parity).getByRole('button', { name: /^evt-\d{3}$/ })).toHaveCount(60);
      }
      // Failed exports (500 and network) show the error panel, 403 shows no-access.
      for (const variant of ['500', 'network', '403']) {
        await openAudit(parity, copy, { 'metrics.workspace.exports': variant });
        await exportButton(parity, copy).click();
        await expect(surface(parity).getByRole('heading', { name: variant === '403' ? copy.audit.noAccess : copy.export.errorTitle, level: 2 })).toBeVisible();
        await expect(surface(parity).getByRole('button', { name: copy.export.download })).toHaveCount(0);
      }
      // Restricted role: no Auditoria tab and no audit request.
      const restrictedFrom = parity.network.requests.length;
      await withRole(parity, server, ['tenant_developer']);
      await expect(surface(parity).getByRole('tab', { name: copy.tabAudit, exact: true })).toHaveCount(0);
      await expect(surface(parity).getByRole('tab', { name: copy.tabMetrics, exact: true })).toBeVisible();
      expect(parity.network.requests.slice(restrictedFrom).filter((request) => /audit-(?:records|exports)/.test(request.path))).toEqual([]);
      // 401: the shell refreshes once, then redirects to /login with the return path.
      const before = parity.network.requests.length;
      await open(parity, { 'metrics.workspace.overview': '401', refresh: '401' }).catch(() => {});
      await expect(parity.page).toHaveURL(/\/login$/);
      expect(parity.network.requests.slice(before).filter((request) => request.method === 'POST')).toHaveLength(1);
      expect(await parity.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(new URL(server.url('console/observability')).pathname);
      allowlist(parity);
    });
    test('accessibility', async ({ parity }) => {
      await open(parity);
      await check.assertAccessibility(parity); await check.assertLocale(parity);
      await surface(parity).getByRole('tab', { name: copy.tabAudit, exact: true }).focus();
      await parity.page.keyboard.press('Enter');
      await expect(surface(parity).getByRole('button', { name: 'evt-001', exact: true })).toBeVisible();
      await check.assertAccessibility(parity); await check.assertLocale(parity);
      const trigger = surface(parity).getByRole('button', { name: 'evt-001', exact: true });
      await keyboardActivate(parity.page, trigger);
      await expect(dialog(parity)).toBeVisible();
      await check.assertAccessibility(parity); await check.assertLocale(parity);
      await parity.page.keyboard.press('Escape');
      await expect(dialog(parity)).toHaveCount(0);
      await expect(trigger).toBeFocused();
      // The export button exposes aria-busy while a request runs; each callout and the error panel pass axe.
      for (const variant of ['slow', 'manifest', 'accepted-no-manifest', '500']) {
        await openAudit(parity, copy, { 'metrics.workspace.exports': variant });
        await exportButton(parity, copy).click();
        if (variant === 'slow') {
          // The export stays pending (1.5 s fixture delay) while the running callout is scanned.
          await expect(surface(parity).getByRole('button', { name: copy.export.running, exact: true })).toHaveAttribute('aria-busy', 'true');
          await expect(surface(parity).getByRole('button', { name: copy.export.running, exact: true })).toBeDisabled();
          await expect(surface(parity).getByRole('status').filter({ hasText: copy.export.progressTitle })).toBeVisible();
          await check.assertAccessibility(parity); await check.assertLocale(parity);
          await expect(surface(parity).getByText(copy.export.readyTitle, { exact: true })).toBeVisible();
          continue;
        }
        await expect(exportButton(parity, copy)).toBeVisible();
        await check.assertAccessibility(parity); await check.assertLocale(parity);
        if (variant === '500') await expect(surface(parity).locator('[data-export-error]')).toBeFocused();
      }
      await openAudit(parity, copy, { 'metrics.workspace.exports': '500-then-success' });
      await exportButton(parity, copy).click();
      await surface(parity).getByRole('button', { name: copy.export.retry, exact: true }).click();
      await expect(surface(parity).getByRole('button', { name: copy.export.download, exact: true })).toBeFocused();
      // The disabled window select exposes its reason.
      await open(parity, { workspaces: 'empty' });
      await check.assertAccessibility(parity); await check.assertLocale(parity);
      // After Cargar mas focus moves to the first appended row when the button disappears.
      await openAudit(parity, copy, { 'metrics.workspace.records': 'first-page-has-more' });
      await surface(parity).getByRole('button', { name: copy.audit.loadMore, exact: true }).focus();
      await parity.page.keyboard.press('Enter');
      await expect(surface(parity).getByRole('button', { name: 'evt-051', exact: true })).toBeFocused();
    });
    test('runtime-health', async ({ parity, server }) => {
      await open(parity);
      await surface(parity).getByRole('tab', { name: copy.tabAudit, exact: true }).click();
      await surface(parity).getByRole('tab', { name: copy.tabMetrics, exact: true }).click();
      await surface(parity).getByRole('combobox', { name: copy.metrics.windowLabel, exact: true }).click();
      await parity.page.getByRole('option', { name: '30d', exact: true }).click();
      await surface(parity).getByRole('tab', { name: copy.tabAudit, exact: true }).click();
      await surface(parity).getByRole('searchbox', { name: copy.audit.actor, exact: true }).fill('ana');
      await check.assertRuntimeHealth(parity);
      await openAudit(parity, copy, { 'metrics.workspace.records': 'first-page-has-more' });
      await surface(parity).getByRole('button', { name: copy.audit.loadMore, exact: true }).click();
      await expect(surface(parity).getByRole('button', { name: /^evt-\d{3}$/ })).toHaveCount(60);
      await exportButton(parity, copy).click();
      await expect(surface(parity).getByText(copy.export.readyTitle, { exact: true })).toBeVisible();
      const [file] = await Promise.all([parity.page.waitForEvent('download'), surface(parity).getByRole('button', { name: copy.export.download, exact: true }).click()]);
      expect(file.suggestedFilename()).toBe('exp-synthetic-1.json');
      await parity.page.waitForTimeout(1200);
      await check.assertRuntimeHealth(parity);
      await openAudit(parity, copy, { 'metrics.workspace.exports': '500-then-success' });
      await exportButton(parity, copy).click();
      await surface(parity).getByRole('button', { name: copy.export.retry, exact: true }).click();
      await expect(surface(parity).getByText(copy.export.readyTitle, { exact: true })).toBeVisible();
      await check.assertRuntimeHealth(parity);
      // No audit request for the restricted role and no series request at tenant scope.
      const restrictedFrom = parity.network.requests.length;
      await withRole(parity, server, ['tenant_developer']);
      expect(parity.network.requests.slice(restrictedFrom).filter((request) => /audit-/.test(request.path))).toEqual([]);
      await check.assertRuntimeHealth(parity);
      const tenantFrom = parity.network.requests.length;
      await open(parity, { workspaces: 'empty' });
      expect(parity.network.requests.slice(tenantFrom).filter((request) => request.path.endsWith('/series'))).toEqual([]);
      await check.assertRuntimeHealth(parity);
      allowlist(parity);
    });
    test('responsive', async ({ parity }) => {
      await open(parity); await check.assertResponsive(parity, width);
      await surface(parity).getByRole('tab', { name: copy.tabAudit, exact: true }).click();
      await check.assertResponsive(parity, width);
      const columns = await surface(parity).getByRole('combobox', { name: copy.audit.result, exact: true }).evaluate((node) => {
        let grid = node.parentElement;
        while (grid && getComputedStyle(grid).display !== 'grid') grid = grid.parentElement;
        return grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0;
      });
      expect(columns).toBe(width === 375 ? 1 : width === 768 ? 2 : 3);
      const button = await exportButton(parity, copy).boundingBox();
      const main = await parity.page.getByRole('main').boundingBox();
      if (width === 375) expect(button.width).toBeGreaterThan(main.width * 0.7);
      await surface(parity).getByRole('button', { name: 'evt-001', exact: true }).click();
      await expect(dialog(parity)).toBeVisible();
      const bounds = await dialog(parity).boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await parity.page.keyboard.press('Escape');
      await openAudit(parity, copy, { 'metrics.workspace.exports': '500' });
      await exportButton(parity, copy).click();
      await expect(surface(parity).getByRole('heading', { name: copy.export.errorTitle, level: 2 })).toBeVisible();
      await check.assertResponsive(parity, width);
      // The audit table scrolls inside its container, never the document.
      await open(parity, { workspaces: 'empty' }); await check.assertResponsive(parity, width);
    });
    test('visual-review', async ({ parity }, info) => {
      async function capture(name) {
        await check.assertLocale(parity);
        const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
        await info.attach(`${name}-${locale}-${width}-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
      }
      await open(parity); await capture('metrics-24h-mixed-posture');
      // Select the 7d window so the selector, chart label and summary match the seven-day points.
      await open(parity, { 'metrics.workspace.series': '7d' });
      const windowFrom = parity.network.requests.length;
      await surface(parity).getByRole('combobox', { name: copy.metrics.windowLabel, exact: true }).click();
      await parity.page.getByRole('option', { name: '7d', exact: true }).click();
      await expect.poll(() => lines(parity, windowFrom)).toContain(`GET ${workspace}/series?metricKey=api_requests&window=7d`);
      await expect(surface(parity).getByRole('combobox', { name: copy.metrics.windowLabel, exact: true })).toContainText('7d');
      await expect(surface(parity).locator('[aria-busy="true"]')).toHaveCount(0);
      await capture('metrics-7d');
      await open(parity, { workspaces: 'empty' }); await capture('tenant-scope-disabled-window');
      await open(parity, { 'metrics.workspace.overview': 'empty' }); await capture('metrics-empty');
      await open(parity, { 'metrics.workspace.overview': '500' }); await capture('metrics-error');
      await openAudit(parity, copy, { 'metrics.workspace.records': 'first-page-has-more' }); await capture('audit-load-more');
      await surface(parity).getByRole('button', { name: 'evt-001', exact: true }).click(); await expect(dialog(parity)).toBeVisible(); await capture('audit-drawer');
      await parity.page.keyboard.press('Escape');
      // The running callout is captured while the delayed export is still pending.
      await openAudit(parity, copy, { 'metrics.workspace.exports': 'slow' });
      await exportButton(parity, copy).click();
      await expect(surface(parity).getByRole('status').filter({ hasText: copy.export.progressTitle })).toBeVisible();
      await capture('export-running');
      await expect(surface(parity).getByText(copy.export.readyTitle, { exact: true })).toBeVisible();
      for (const variant of ['manifest', 'accepted-no-manifest', '500']) {
        await openAudit(parity, copy, { 'metrics.workspace.exports': variant });
        await exportButton(parity, copy).click();
        await expect(exportButton(parity, copy)).toBeEnabled();
        await capture(`export-${variant}`);
      }
      // Tenant scope export failure (audit.tenant.exports:500).
      await open(parity, { workspaces: 'empty', 'metrics.tenant.exports': '500' });
      await surface(parity).getByRole('tab', { name: copy.tabAudit, exact: true }).click();
      await exportButton(parity, copy).click();
      await expect(surface(parity).getByRole('heading', { name: copy.export.errorTitle, level: 2 })).toBeVisible();
      await capture('export-tenant-500');
      await openAudit(parity, copy, { 'metrics.workspace.records': 'empty' }); await capture('audit-empty');
      await openAudit(parity, copy, { 'metrics.workspace.records': '500' }); await capture('audit-error');
      await open(parity, { tenants: 'empty' }); await capture('blocked');
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
  });
}
