import { createHash } from 'node:crypto';
import manifest, {
  tenantId, cspTenantId, planPath, entitlementsPath, historyPath, plansActivePath, entitlementsSearch, plansSearch, assignedBody, tenantPlanEndpoints, historyResponse, plansResponse,
} from './console-tenant-plan-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';
import { installSession } from '../../browser-session.mjs';
import es from '../../../src/locales/es/pages.console-tenant-plan-page.json' with { type: 'json' };
import en from '../../../src/locales/en/pages.console-tenant-plan-page.json' with { type: 'json' };

// Every plan request is served by one page-local route: it reads the query and the method, keeps
// per-request sequences, and records anything outside the four approved reads and the one write.
const states = new WeakMap();
const copy = (parity) => parity.locale === 'es' ? es : en;
const historySearch = (page) => `?page=${page}&pageSize=20`;
const fixture = (name, variant, attempt) => {
  const value = tenantPlanEndpoints[name].fixtures[variant];
  if (value === undefined) throw new Error(`Unknown fixture ${name} ${variant}`);
  return Array.isArray(value) ? value[Math.min(attempt, value.length - 1)] : value;
};
function classify(method, url) {
  if (method === 'GET' && url.pathname === planPath() && !url.search) return 'plan';
  if (method === 'GET' && url.pathname === entitlementsPath() && url.search === entitlementsSearch) return 'entitlements';
  if (method === 'GET' && url.pathname === historyPath() && /^\?page=\d+&pageSize=20$/.test(url.search)) return 'history';
  if (method === 'GET' && url.pathname === plansActivePath && url.search === plansSearch) return 'plans';
  if (method === 'POST' && url.pathname === planPath() && !url.search) return 'assign';
  return null;
}
const responses = {
  plan: (variant, attempt) => fixture('tenantPlan', variant, attempt),
  entitlements: (variant, attempt) => fixture('tenantEntitlements', variant, attempt),
  assign: (variant, attempt) => fixture('tenantPlanAssign', variant, attempt),
  history: (variant, attempt, url) => historyResponse(variant, url, attempt),
  plans: (variant, attempt) => plansResponse(variant, attempt),
};
const defaults = { plan: 'success', entitlements: 'success', history: 'success', plans: 'active', assign: 'success' };

test.beforeEach(async ({ parity }) => {
  const state = { variants: { ...defaults }, attempts: {}, strays: [] };
  const injected = [];
  states.set(parity, state);
  await parity.page.route((url) => [planPath(), entitlementsPath(), historyPath(), plansActivePath].includes(url.pathname), async (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    let body;
    try { body = request.postDataJSON() ?? undefined; } catch { body = request.postData(); }
    parity.network.requests.push({ method, path: url.pathname + url.search, body });
    const kind = classify(method, url);
    if (!kind) { state.strays.push(`${method} ${url.pathname}${url.search}`); await route.abort(); return; }
    const attempt = state.attempts[kind] = (state.attempts[kind] ?? -1) + 1;
    const response = responses[kind](state.variants[kind], attempt, url);
    if (response.delayMs) await new Promise((resolve) => setTimeout(resolve, response.delayMs));
    if (response.network || response.status >= 400) injected.push({ url: request.url(), kind: response.network ? 'network' : String(response.status) });
    if (response.network) await route.abort('failed');
    else await route.fulfill({ status: response.status, json: response.body });
  });
  // Consume only the exact resource diagnostic of a deliberately injected failure.
  parity.page.on('console', (message) => {
    if (message.type() !== 'error' || !consumeResourceDiagnostic(message.text(), message.location().url, injected)) return;
    const index = parity.faults.indexOf(`console.error: ${message.text()}`);
    if (index >= 0) parity.faults.splice(index, 1);
  });
});
test.afterEach(({ parity }) => { expect(states.get(parity)?.strays ?? [], 'plan requests outside the approved list').toEqual([]); });

// Mid-flow changes merge into the active variants; every navigation starts from the defaults and a clean request log.
const variants = (parity, overrides = {}) => Object.assign(states.get(parity).variants, overrides);
function configure(parity, overrides = {}) {
  const state = states.get(parity);
  state.variants = { ...defaults, ...overrides };
  state.attempts = {};
  parity.network.requests.length = 0;
}
// Restarts the response sequence of one request kind, e.g. so a fixture list begins at its first entry.
const restartSequence = (parity, kind) => { delete states.get(parity).attempts[kind]; };
async function open(parity, overrides = {}, shell = {}) {
  configure(parity, overrides);
  await parity.open(manifest.route, { tenants: 'empty', ...shell });
}
// Navigates without waiting for the page to settle, to observe loading and redirects.
async function visit(parity, server, overrides = {}, shell = {}) {
  configure(parity, overrides);
  parity.network.setVariants({ tenants: 'empty', ...shell });
  await parity.page.goto(server.url(`console/tenants/${tenantId}/plan`));
}
const planRequests = (parity, method, pathname) => parity.network.requests.filter((request) => request.method === method && request.path.split('?')[0] === pathname);
const posts = (parity) => planRequests(parity, 'POST', planPath());
const tab = (parity, key) => parity.page.getByRole('tab', { name: copy(parity)[key], exact: true });
const heading = (parity, name) => parity.page.getByRole('heading', { name, exact: true });
const button = (parity, name) => parity.page.getByRole('button', { name, exact: true });
const dialog = (parity) => parity.page.getByRole('dialog', { name: copy(parity).dialog.title.replace('{tenantId}', tenantId), exact: true });
const planSelect = (parity) => dialog(parity).getByRole('combobox', { name: copy(parity).dialog.activePlan, exact: true });
const entries = (parity) => parity.page.getByTestId('plan-history-entry');
const trigger = (parity, key = 'changePlan') => parity.page.getByRole('button', { name: copy(parity)[key], exact: true, includeHidden: true });
const summaryReady = (parity) => expect(parity.page.getByText('Synthetic Pro', { exact: true })).toBeVisible();
async function chooseOption(parity, option) {
  await planSelect(parity).click();
  await parity.page.getByRole('option', { name: option, exact: true }).click();
}
async function openDialog(parity, key = 'changePlan') {
  await trigger(parity, key).click();
  await expect(dialog(parity)).toBeVisible();
}
async function openAssignment(parity, overrides = {}, shell = {}) {
  await open(parity, overrides, shell);
  await openDialog(parity);
  await expect(planSelect(parity)).toBeEnabled();
  await chooseOption(parity, 'Synthetic Team');
  await button(parity, copy(parity).dialog.confirm).click();
}
async function openHistory(parity, overrides = {}) {
  await open(parity, overrides);
  await tab(parity, 'tabHistory').click();
}
async function snapshot(parity, info, name) {
  await check.assertLocale(parity);
  const screenshot = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
  const digest = createHash('sha256').update(screenshot).digest('hex');
  await info.attach(`${name}-${parity.locale}-sha256-${digest}`, { body: screenshot, contentType: 'image/png' });
}

for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-tenant-plan-page | superadmin | ${locale} | ${width}`, () => {
    test.use({ role: 'superadmin', locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test('data', async ({ parity }) => {
      const c = copy(parity);
      await open(parity);
      await summaryReady(parity);
      await expect(parity.page.getByRole('heading', { level: 1, name: c.title, exact: true })).toBeVisible();
      await expect(parity.page.getByText(c.status.active, { exact: true })).toBeVisible();
      await expect(parity.page.getByText(tenantId, { exact: true })).toBeVisible();
      const rows = parity.page.getByRole('table').getByRole('row').filter({ has: parity.page.getByRole('cell') });
      await expect(rows).toHaveCount(5);
      await expect(parity.page.getByText(c.summary.unlimited, { exact: true }).first()).toBeVisible();
      await expect(parity.page.getByRole('meter')).toHaveCount(3);
      await expect(parity.page.locator('main')).not.toContainText(/[$€]|\/\s?(mo|month|mes)\b|renov|renew/i);
      const reads = parity.network.requests.filter((request) => request.path.startsWith(`/v1/tenants/${tenantId}/`) || request.path.startsWith('/v1/plans')).map((request) => `${request.method} ${request.path}`);
      expect(reads.sort()).toEqual([
        `GET ${planPath()}`, `GET ${entitlementsPath()}${entitlementsSearch}`, `GET ${historyPath()}${historySearch(1)}`, `GET ${plansActivePath}${plansSearch}`,
      ].sort());
      await tab(parity, 'tabHistory').click();
      await expect(entries(parity)).toHaveCount(20);
      await expect(parity.page.getByText(locale === 'es' ? '1-20 de 45' : '1-20 of 45', { exact: true })).toBeVisible();
      await entries(parity).first().getByRole('button', { name: new RegExp(c.history.showDetails) }).click();
      await expect(entries(parity).first().getByRole('heading', { name: c.history.impactSummary })).toBeVisible();
      await expect(entries(parity).first().getByRole('table')).toHaveCount(2);
      await expect(entries(parity).first().getByText('Synthetic SSO', { exact: true })).toBeVisible();
      await check.assertLocale(parity);
    });
    test('action', async ({ parity }) => {
      const c = copy(parity);
      await open(parity, { history: 'page2-delayed', plans: 'loading', plan: 'tenant-plan-reassigned', assign: 'tenant-plan-assign-delayed' });
      await summaryReady(parity);
      // The catalogue answers late: the field shows its loading state with the select and Confirmar disabled.
      // This runs before the delayed history page so the catalogue is still pending.
      await openDialog(parity);
      await expect(dialog(parity).getByText(c.dialog.loadingPlans, { exact: true })).toBeVisible();
      await expect(planSelect(parity)).toBeDisabled();
      await expect(button(parity, c.dialog.confirm)).toBeDisabled();
      await expect(planSelect(parity)).toBeEnabled();
      await button(parity, c.dialog.cancel).click();
      await expect(dialog(parity)).toHaveCount(0);
      // Page 2 of the history: skeleton while it loads, then its entries, with the exact query.
      await tab(parity, 'tabHistory').click();
      await expect(entries(parity)).toHaveCount(20);
      await parity.page.getByRole('button', { name: locale === 'es' ? 'Página 2' : 'Page 2', exact: true }).click();
      await expect(parity.page.getByRole('status', { name: c.loadingHistory, exact: true })).toBeVisible();
      await expect(parity.page.getByText('synthetic-admin-21', { exact: false }).first()).toBeVisible();
      expect(planRequests(parity, 'GET', historyPath()).at(-1)).toEqual({ method: 'GET', path: `${historyPath()}${historySearch(2)}`, body: undefined });
      await tab(parity, 'tabSummary').click();
      await openDialog(parity);
      await expect(planSelect(parity)).toBeEnabled();
      await expect(planSelect(parity)).toContainText('Synthetic Pro');
      await chooseOption(parity, 'Synthetic Team');
      await button(parity, c.dialog.confirm).click();
      const busy = button(parity, c.dialog.confirming);
      await expect(busy).toHaveAttribute('aria-busy', 'true');
      await expect(busy).toBeDisabled();
      await expect(trigger(parity)).toHaveAttribute('aria-busy', 'true');
      await expect(trigger(parity)).toBeDisabled();
      // A repeated click or Enter while busy sends nothing more.
      await busy.click({ force: true });
      await dialog(parity).locator('form').evaluate((form) => form.requestSubmit());
      await expect(dialog(parity)).toHaveCount(0);
      expect(posts(parity)).toEqual([{ method: 'POST', path: planPath(), body: assignedBody }]);
      await expect(parity.page.getByText('Synthetic Team', { exact: true }).first()).toBeVisible();
      await expect(parity.page.getByText(c.assigned.replace('{plan}', 'Synthetic Team'), { exact: true }).first()).toBeVisible();
      expect(planRequests(parity, 'GET', planPath())).toHaveLength(2);
      expect(planRequests(parity, 'GET', entitlementsPath())).toHaveLength(2);
      await expect(trigger(parity)).toBeFocused();
    });
    test('error-empty', async ({ parity, server }) => {
      test.setTimeout(240_000);
      const c = copy(parity);
      // Loading: skeletons until both reads answer.
      for (const read of ['plan', 'entitlements']) {
        await visit(parity, server, { [read]: 'tenant-plan-loading-delayed' });
        await expect(parity.page.getByRole('status', { name: c.loadingPlan, exact: true })).toBeVisible();
        await expect(parity.page.getByText('Synthetic Pro', { exact: true })).toHaveCount(0);
        await summaryReady(parity);
      }
      // Empty copies.
      await open(parity, { plan: 'tenant-plan-unassigned', entitlements: 'tenant-entitlements-no-limits' });
      await expect(parity.page.getByText(c.summary.noLimitsUnassigned, { exact: true })).toBeVisible();
      await expect(button(parity, c.assignPlan)).toBeVisible();
      await open(parity, { plan: 'success', entitlements: 'tenant-entitlements-no-limits' });
      await expect(parity.page.getByText(c.summary.noLimitsAssigned, { exact: true })).toBeVisible();
      // Page-level failures replace the summary; no partial plan shows.
      for (const read of ['plan', 'entitlements']) for (const [variant, key] of [['403', 'noAccessTitle'], ['404', 'notFoundTitle'], ['500', 'errorTitle'], ['network', 'errorTitle']]) {
        await visit(parity, server, { [read]: variant });
        await expect(heading(parity, c.plan[key])).toBeVisible();
        await expect(parity.page.getByText('Synthetic Pro', { exact: true })).toHaveCount(0);
        await expect(parity.page.getByRole('tab')).toHaveCount(0);
        await expect(button(parity, c.retry)).toHaveCount(['500', 'network'].includes(variant) ? 1 : 0);
        if (variant === '404') await expect(parity.page.getByRole('link', { name: c.plan.backToTenants, exact: true })).toHaveAttribute('href', '/console/tenants');
        if (variant === '500') {
          await expect(parity.page.getByText(`req_synthetic_${read === 'plan' ? 'plan' : 'entitlements'}_500`, { exact: true })).toBeVisible();
          variants(parity, { [read]: 'success' });
          const before = [planRequests(parity, 'GET', planPath()).length, planRequests(parity, 'GET', entitlementsPath()).length];
          await button(parity, c.retry).click();
          await summaryReady(parity);
          expect([planRequests(parity, 'GET', planPath()).length, planRequests(parity, 'GET', entitlementsPath()).length]).toEqual(before.map((value) => value + 1));
        }
      }
      // Historial failures stay local; Resumen remains usable.
      await openHistory(parity, { plan: 'success', entitlements: 'success', history: 'empty' });
      await expect(heading(parity, c.history.empty)).toBeVisible();
      for (const [variant, key] of [['403', 'noAccessTitle'], ['404', 'notFoundTitle'], ['500', 'errorTitle'], ['network', 'errorTitle']]) {
        await openHistory(parity, { history: variant });
        await expect(heading(parity, c.history[key])).toBeVisible();
        await expect(button(parity, c.retry)).toHaveCount(['500', 'network'].includes(variant) ? 1 : 0);
        await expect(button(parity, c.history.backToSummary)).toHaveCount(variant === '404' ? 1 : 0);
        if (variant === '500') {
          await expect(parity.page.getByText('req_synthetic_history_500', { exact: true })).toBeVisible();
          variants(parity, { history: 'success' });
          const before = planRequests(parity, 'GET', historyPath()).length;
          await button(parity, c.retry).click();
          await expect(entries(parity)).toHaveCount(20);
          expect(planRequests(parity, 'GET', historyPath()).length).toBe(before + 1);
        }
        if (variant === '404') { await button(parity, c.history.backToSummary).click(); await expect(tab(parity, 'tabSummary')).toHaveAttribute('aria-selected', 'true'); }
        else await tab(parity, 'tabSummary').click();
        await summaryReady(parity);
      }
      // Catalogue states inside the dialog.
      await open(parity, { history: 'success', plans: 'empty' });
      await openDialog(parity);
      await expect(heading(parity, c.dialog.noPlansTitle)).toBeVisible();
      await expect(button(parity, c.dialog.confirm)).toBeDisabled();
      for (const [variant, key] of [['403', 'noAccessTitle'], ['404', 'notFoundTitle'], ['500', 'errorTitle'], ['network', 'errorTitle']]) {
        await open(parity, { plans: variant });
        await openDialog(parity);
        await expect(heading(parity, c.plans[key])).toBeVisible();
        await expect(planSelect(parity)).toBeDisabled();
        await expect(button(parity, c.dialog.confirm)).toBeDisabled();
        if (['500', 'network'].includes(variant)) {
          variants(parity, { plans: 'active' });
          const before = parity.network.requests.length;
          await dialog(parity).getByRole('button', { name: c.retry, exact: true }).click();
          await expect(planSelect(parity)).toBeEnabled();
          expect(parity.network.requests.slice(before).map((request) => `${request.method} ${request.path}`)).toEqual([`GET ${plansActivePath}${plansSearch}`]);
        }
      }
      // Assignment failures keep the dialog open and the selected plan.
      await openAssignment(parity, { plans: 'active', assign: '403' });
      await expect(heading(parity, c.assign.noAccessTitle)).toBeVisible();
      await expect(planSelect(parity)).toContainText('Synthetic Team');
      await expect(dialog(parity).getByRole('button', { name: c.retry })).toHaveCount(0);
      await button(parity, c.dialog.close).click();
      await expect(trigger(parity)).toBeFocused();
      await openAssignment(parity, { assign: '404' });
      await expect(heading(parity, c.assign.notFoundTitle.replace('{plan}', 'Synthetic Team'))).toBeVisible();
      variants(parity, { plans: 'without-selected-plan' });
      const beforeAgain = parity.network.requests.length;
      await button(parity, c.assign.chooseAgain).click();
      await expect(planSelect(parity)).toBeFocused();
      expect(parity.network.requests.slice(beforeAgain).map((request) => `${request.method} ${request.path}`)).toEqual([`GET ${plansActivePath}${plansSearch}`]);
      await planSelect(parity).click();
      await expect(parity.page.getByRole('option', { name: 'Synthetic Team', exact: true })).toHaveCount(0);
      await parity.page.keyboard.press('Escape');
      expect(posts(parity)).toHaveLength(1);
      await openAssignment(parity, { plans: 'active', assign: '500' });
      await expect(heading(parity, c.assign.errorTitle)).toBeVisible();
      await expect(parity.page.getByText('req_synthetic_assign_500', { exact: true })).toBeVisible();
      await parity.page.waitForTimeout(400);
      expect(posts(parity)).toHaveLength(1);
      variants(parity, { assign: 'tenant-plan-assign-retry-200' });
      parity.network.requests.length = 0;
      await button(parity, c.retry).click();
      await expect(dialog(parity)).toHaveCount(0);
      expect(posts(parity)).toHaveLength(1);
      // A network error re-reads the plan first and sends no second POST when it is already assigned.
      await openAssignment(parity, { assign: 'network', plan: 'tenant-plan-after-network-already-assigned' });
      await expect(dialog(parity).getByText(c.assign.networkMessage, { exact: true })).toBeVisible();
      await button(parity, c.retry).click();
      await expect(dialog(parity)).toHaveCount(0);
      expect(posts(parity)).toHaveLength(1);
      await openAssignment(parity, { assign: 'network', plan: 'success' });
      await dialog(parity).getByText(c.assign.networkMessage, { exact: true }).waitFor();
      await button(parity, c.retry).click();
      await expect.poll(() => posts(parity).length).toBe(2);
      // Session expiry: a failed refresh redirects, a successful one waits for an explicit Confirmar.
      await openAssignment(parity, { assign: 'tenant-plan-assign-401-refresh-ok', plan: 'success' });
      await expect(dialog(parity).getByText(c.dialog.sessionRenewed, { exact: true })).toBeVisible();
      await parity.page.waitForTimeout(400);
      expect(posts(parity)).toHaveLength(1);
      await expect(planSelect(parity)).toContainText('Synthetic Team');
      await button(parity, c.dialog.confirm).click();
      await expect(dialog(parity)).toHaveCount(0);
      expect(posts(parity)).toHaveLength(2);
      await openAssignment(parity, { assign: '401' }, { refresh: '401' });
      await expect(parity.page).toHaveURL(server.url('login'));
      expect(posts(parity)).toHaveLength(1);
      // Read 401: one refresh, then /login with the return path preserved.
      await visit(parity, server, { plan: '401' });
      await expect(parity.page).toHaveURL(server.url('login'));
      expect(parity.network.requests.filter((request) => request.path.endsWith('/refresh'))).toHaveLength(1);
      expect(await parity.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(`/console/tenants/${tenantId}/plan`);
    });
    test('accessibility', async ({ parity }) => {
      test.setTimeout(120_000);
      const c = copy(parity);
      await open(parity);
      await summaryReady(parity);
      await check.assertAccessibility(parity);
      // Tabs follow arrow keys.
      await tab(parity, 'tabSummary').focus();
      await parity.page.keyboard.press('ArrowRight');
      await expect(tab(parity, 'tabHistory')).toHaveAttribute('aria-selected', 'true');
      await expect(entries(parity)).toHaveCount(20);
      await check.assertAccessibility(parity);
      const first = entries(parity).first().getByRole('button', { name: new RegExp(c.history.showDetails) });
      await expect(first).toHaveAttribute('aria-expanded', 'false');
      await first.focus(); await parity.page.keyboard.press('Enter');
      await expect(entries(parity).first().getByRole('button', { name: new RegExp(c.history.hideDetails) })).toHaveAttribute('aria-expanded', 'true');
      // Pagination is keyboard operable and focus lands on the first new entry.
      const next = parity.page.getByRole('button', { name: c.history.nextPage, exact: true });
      await next.focus(); await parity.page.keyboard.press('Enter');
      await expect(parity.page.getByText('synthetic-admin-21', { exact: false }).first()).toBeVisible();
      await expect(entries(parity).first()).toBeFocused();
      // The dialog traps focus and returns it to Cambiar plan on Cancelar.
      await tab(parity, 'tabSummary').click();
      await openDialog(parity);
      await expect(planSelect(parity)).toBeEnabled();
      await check.assertAccessibility(parity);
      for (let index = 0; index < 8; index++) await parity.page.keyboard.press('Tab');
      expect(await parity.page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
      await button(parity, c.dialog.cancel).click();
      await expect(dialog(parity)).toHaveCount(0);
      await expect(trigger(parity)).toBeFocused();
      // Failure states: axe, announced headings and reachable recovery actions.
      await openAssignment(parity, { assign: '404' });
      await expect(heading(parity, c.assign.notFoundTitle.replace('{plan}', 'Synthetic Team'))).toBeVisible();
      await check.assertAccessibility(parity);
      // The not-found heading sits in a live region, so the failure is announced while focus moves to the recovery action.
      await expect(dialog(parity).locator('[role="alert"]').getByRole('heading', { name: c.assign.notFoundTitle.replace('{plan}', 'Synthetic Team'), exact: true })).toBeVisible();
      await expect(button(parity, c.assign.chooseAgain)).toBeFocused();
      await button(parity, c.assign.chooseAgain).click();
      await expect(planSelect(parity)).toBeFocused();
      await button(parity, c.dialog.cancel).click();
      await openAssignment(parity, { assign: '500' });
      await expect(heading(parity, c.assign.errorTitle)).toBeVisible();
      await check.assertAccessibility(parity);
      await expect(button(parity, c.retry)).toBeFocused();
      await button(parity, c.dialog.close).click();
      await open(parity, { plans: '500' });
      await openDialog(parity);
      await expect(heading(parity, c.plans.errorTitle)).toBeVisible();
      await check.assertAccessibility(parity);
      await openHistory(parity, { plans: 'active', history: '500' });
      await expect(heading(parity, c.history.errorTitle)).toBeVisible();
      await check.assertAccessibility(parity);
      variants(parity, { history: '500-then-success' });
      await button(parity, c.retry).focus();
      await parity.page.keyboard.press('Enter');
      await check.assertLocale(parity);
    });
    test('kit-conformance', async ({ parity }) => {
      await check.kitConformance(manifest);
      await open(parity);
      await summaryReady(parity);
      // plan-card shows price, cycle and renewal; none may render.
      await expect(parity.page.locator('[data-slot="plan-card"], [class*="plan-card"]')).toHaveCount(0);
      await expect(parity.page.getByRole('switch')).toHaveCount(0);
      await expect(parity.page.locator('main')).not.toContainText(/[$€]/);
      await check.assertLocale(parity);
    });
    test('runtime-health', async ({ parity }) => {
      const c = copy(parity);
      await open(parity, { history: 'page2-delayed' });
      await summaryReady(parity);
      await tab(parity, 'tabHistory').click();
      await parity.page.getByRole('button', { name: locale === 'es' ? 'Página 2' : 'Page 2', exact: true }).click();
      await expect(parity.page.getByText('synthetic-admin-21', { exact: false }).first()).toBeVisible();
      variants(parity, { history: '500' });
      await parity.page.getByRole('button', { name: c.history.nextPage, exact: true }).click();
      await expect(heading(parity, c.history.errorTitle)).toBeVisible();
      variants(parity, { history: 'success' });
      await button(parity, c.retry).click();
      // The last page of the 45-entry fixture holds 5 entries.
      await expect(entries(parity)).toHaveCount(5);
      await expect(parity.page.getByText(locale === 'es' ? '41-45 de 45' : '41-45 of 45', { exact: true })).toBeVisible();
      await open(parity, { plans: '500' });
      await openDialog(parity);
      await expect(heading(parity, c.plans.errorTitle)).toBeVisible();
      variants(parity, { plans: 'active' });
      await dialog(parity).getByRole('button', { name: c.retry, exact: true }).click();
      await expect(planSelect(parity)).toBeEnabled();
      await chooseOption(parity, 'Synthetic Team');
      variants(parity, { assign: '404' });
      await button(parity, c.dialog.confirm).click();
      await expect(heading(parity, c.assign.notFoundTitle.replace('{plan}', 'Synthetic Team'))).toBeVisible();
      variants(parity, { plans: 'without-selected-plan' });
      await button(parity, c.assign.chooseAgain).click();
      await expect(planSelect(parity)).toBeEnabled();
      // The 404 consumed the first POST response; restart the sequence so this POST fails and the retry recovers.
      variants(parity, { assign: 'tenant-plan-assign-retry-200' });
      restartSequence(parity, 'assign');
      await button(parity, c.dialog.confirm).click();
      await expect(heading(parity, c.assign.errorTitle)).toBeVisible();
      await button(parity, c.retry).click();
      await expect(dialog(parity)).toHaveCount(0);
      await check.assertRuntimeHealth(parity);
    });
    test('responsive', async ({ parity }) => {
      const c = copy(parity);
      await open(parity);
      await summaryReady(parity);
      await check.assertResponsive(parity, width);
      await tab(parity, 'tabHistory').click();
      await entries(parity).first().getByRole('button', { name: new RegExp(c.history.showDetails) }).click();
      await expect(entries(parity).first().getByRole('table')).toHaveCount(2);
      await check.assertResponsive(parity, width);
      await openAssignment(parity, { assign: '404' });
      await expect(heading(parity, c.assign.notFoundTitle.replace('{plan}', 'Synthetic Team'))).toBeVisible();
      await check.assertResponsive(parity, width);
      const box = await dialog(parity).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await button(parity, c.dialog.close).click();
      await openAssignment(parity, { assign: '500' });
      await expect(heading(parity, c.assign.errorTitle)).toBeVisible();
      await check.assertResponsive(parity, width);
      const error = await dialog(parity).boundingBox();
      expect(error.x + error.width).toBeLessThanOrEqual(width);
    });
    test('visual-review', async ({ parity }, info) => {
      const c = copy(parity);
      await open(parity); await summaryReady(parity);
      await snapshot(parity, info, 'summary');
      await tab(parity, 'tabHistory').click();
      await expect(entries(parity)).toHaveCount(20);
      await entries(parity).first().getByRole('button', { name: new RegExp(c.history.showDetails) }).click();
      await expect(entries(parity).first().getByRole('table')).toHaveCount(2);
      await snapshot(parity, info, 'history-expanded');
      await openHistory(parity, { history: '500' });
      await expect(heading(parity, c.history.errorTitle)).toBeVisible();
      await snapshot(parity, info, 'history-error');
      await open(parity, { history: 'success', plans: '500' });
      await openDialog(parity);
      await expect(heading(parity, c.plans.errorTitle)).toBeVisible();
      await snapshot(parity, info, 'dialog-catalogue-error');
      await openAssignment(parity, { plans: 'active', assign: '404' });
      await expect(heading(parity, c.assign.notFoundTitle.replace('{plan}', 'Synthetic Team'))).toBeVisible();
      await snapshot(parity, info, 'dialog-assign-not-found');
      await openAssignment(parity, { assign: '500' });
      await expect(heading(parity, c.assign.errorTitle)).toBeVisible();
      await snapshot(parity, info, 'dialog-assign-error');
      await open(parity, { plan: '500' });
      await expect(heading(parity, c.plan.errorTitle)).toBeVisible();
      await snapshot(parity, info, 'page-error');
      // Artifacts are evidence for the independent checker and operator's visual approval.
    });
  });
}

for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`Tenant plan CSP negatives ${locale} ${width}`, () => {
    test.use({ role: 'superadmin', locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test('CSP fixture handler rejects other queries on the tenant plan paths', async ({ parity, server }) => {
      const unmatched = await installSession(parity.page);
      await parity.page.goto(server.url(`console/tenants/${cspTenantId}/plan`));
      await expect(parity.page.getByRole('heading', { level: 1, name: copy(parity).title, exact: true })).toBeVisible();
      await parity.page.evaluate(async (paths) => {
        for (const path of paths) {
          try { await fetch(path); } catch { /* Expected fail-closed fixture rejection. */ }
        }
      }, [`/v1/tenants/${cspTenantId}/plan/history-impact?page=2&pageSize=20`, `/v1/tenants/${cspTenantId}/plan/history-impact?x=1`, `/v1/tenants/${cspTenantId}/plan/effective-entitlements?include=consumption&x=1`]);
      expect(unmatched).toEqual([
        `GET /v1/tenants/${cspTenantId}/plan/history-impact?page=2&pageSize=20`, `GET /v1/tenants/${cspTenantId}/plan/history-impact?x=1`,
        `GET /v1/tenants/${cspTenantId}/plan/effective-entitlements?include=consumption&x=1`,
      ]);
    });
  });
}

for (const role of ['member', 'tenant_owner', 'platform_auditor']) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`Tenant plan permission denial ${role} ${locale} ${width}`, () => {
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test('denies access without a plan request', async ({ parity, server }) => {
      parity.network.setVariants({ tenants: 'empty' });
      await parity.page.goto(server.url(`console/tenants/${tenantId}/plan`));
      await expect(parity.page.getByRole('heading', { name: locale === 'es' ? 'Acceso denegado' : 'Access denied', exact: true })).toBeVisible();
      expect(parity.network.requests.filter((request) => request.path.startsWith(`/v1/tenants/${tenantId}/`) || request.path.startsWith('/v1/plans'))).toHaveLength(0);
      await check.assertRuntimeHealth(parity);
    });
  });
}
