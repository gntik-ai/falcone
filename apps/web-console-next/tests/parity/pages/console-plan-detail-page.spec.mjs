import { createHash } from 'node:crypto';
import manifest, { limitKey, planId, planName, planPath } from './console-plan-detail-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';
import es from '../../../src/locales/es/pages.console-plan-detail-page.json' with { type: 'json' };
import en from '../../../src/locales/en/pages.console-plan-detail-page.json' with { type: 'json' };

const copy = (parity) => parity.locale === 'es' ? es : en;
const base = planPath();
const limitPath = `${base}/limits/${limitKey}`;
const lifecyclePath = `${base}/lifecycle`;
// The harness request log is cumulative across navigations; every assertion looks only at the current open.
const marks = new WeakMap();
const current = (parity) => parity.network.requests.slice(marks.get(parity) ?? 0);
const sent = (parity, method, path) => current(parity).filter((request) => request.method === method && request.path === path);
const writes = (parity) => current(parity).filter((request) => request.method !== 'GET' && request.path.startsWith('/v1/plans/'));
const named = (parity, key) => new RegExp(`^${copy(parity).action[key]} ${planName}`);
const button = (parity, name) => parity.page.getByRole('button', { name });
const dialog = (parity) => parity.page.getByRole('alertdialog');
const h1 = (parity) => parity.page.locator('main h1');
const input = (parity, label = 'Workspaces') => parity.page.getByRole('textbox', { name: `${label}: ${parity.locale === 'es' ? 'valor del límite' : 'limit value'}`, exact: true });
const saveButton = (parity, label = 'Workspaces') => parity.page.getByRole('button', { name: copy(parity).limits.saveName.replace('{dimension}', label), exact: true });
const resetButton = (parity, label = 'Workspaces') => parity.page.getByRole('button', { name: copy(parity).limits.resetName.replace('{dimension}', label), exact: true });
const tab = (parity, key) => parity.page.getByRole('tab', { name: copy(parity).tabs[key], exact: true }).click();
async function open(parity, variants = {}) {
  marks.set(parity, parity.network.requests.length);
  await parity.open(manifest.route, { tenants: 'empty', ...variants });
  await expect(parity.page.getByRole('status', { name: copy(parity).load.loading, exact: true })).toHaveCount(0);
}
async function openReady(parity, variants = {}) {
  await open(parity, variants);
  await expect(h1(parity)).toHaveText(planName);
}
async function typeName(parity) {
  await dialog(parity).getByLabel(copy(parity).dialog.typeLabel, { exact: true }).fill(planName);
}
async function snapshot(parity, info, name) {
  await check.assertLocale(parity);
  const image = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
  const digest = createHash('sha256').update(image).digest('hex');
  await info.attach(`${name}-${parity.locale}-sha256-${digest}`, { body: image, contentType: 'image/png' });
}

for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-plan-detail-page | superadmin | ${locale} | ${width}`, () => {
    test.use({ role: 'superadmin', locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test.beforeEach(async ({ parity }) => {
      // Deliberately injected plan failures log one browser resource diagnostic each; application errors stay faults.
      const injected = [];
      parity.page.on('response', (response) => {
        const url = new URL(response.url());
        if (url.pathname.startsWith('/v1/plans/') && [400, 401, 403, 404, 409, 500].includes(response.status())) injected.push({ url: response.url(), kind: String(response.status()) });
      });
      parity.page.on('requestfailed', (request) => {
        if (new URL(request.url()).pathname.startsWith('/v1/plans/') && request.failure()?.errorText === 'net::ERR_FAILED') injected.push({ url: request.url(), kind: 'network' });
      });
      parity.page.on('console', (message) => {
        if (message.type() !== 'error' || !consumeResourceDiagnostic(message.text(), message.location().url, injected)) return;
        const index = parity.faults.indexOf(`console.error: ${message.text()}`);
        if (index >= 0) parity.faults.splice(index, 1);
      });
    });

    test('data', async ({ parity }) => {
      const c = copy(parity);
      for (const [variant, status] of [['draft', 'draft'], ['active-3-tenants', 'active'], ['deprecated', 'deprecated'], ['archived', 'archived']]) {
        await openReady(parity, { 'plans.detail': variant });
        await expect(parity.page.getByText('synthetic-plan', { exact: true })).toBeVisible();
        await expect(parity.page.getByRole('navigation', { name: c.lifecycle.sequence }).locator('[aria-current="step"]')).toContainText(c.status[status]);
        await expect(parity.page.getByRole('list', { name: c.info.timeline }).getByRole('listitem')).toHaveCount(1);
        await expect(parity.page.getByText(c.info.timelineEntry, { exact: true })).toBeVisible();
        await expect(parity.page.locator('main')).not.toContainText(/\$|€|renew|renov/i);
      }
      await openReady(parity, { 'plans.detail': 'active-3-tenants' });
      await tab(parity, 'capabilities');
      await expect(parity.page.getByRole('list', { name: c.capabilities.list }).getByRole('listitem')).toHaveCount(2);
      await tab(parity, 'limits');
      await expect(parity.page.getByRole('table').getByRole('row')).toHaveCount(7);
      await expect(input(parity)).toHaveValue('5');
      await tab(parity, 'assignments');
      await expect(parity.page.getByText(locale === 'es' ? '3 organizaciones activas usan este plan.' : '3 active organizations use this plan.', { exact: true })).toBeVisible();
      await openReady(parity, { 'plans.detail': 'deprecated' });
      await tab(parity, 'limits');
      await expect(parity.page.getByRole('textbox')).toHaveCount(0);
      await expect(parity.page.getByText(c.limits.unlimited, { exact: true }).first()).toBeVisible();
      expect(writes(parity)).toEqual([]);
    });

    test('action', async ({ parity }) => {
      const c = copy(parity);
      // Activar: no dialog, POST then a plan-only reload.
      await openReady(parity, { 'plans.detail': ['draft', 'active-3-tenants'], 'plans.lifecycle': 'success' });
      await button(parity, named(parity, 'activate')).click();
      await expect(button(parity, named(parity, 'deprecate'))).toBeVisible();
      expect(sent(parity, 'POST', lifecyclePath).map((request) => request.body)).toEqual([{ targetStatus: 'active' }]);
      expect(sent(parity, 'GET', base)).toHaveLength(2); expect(sent(parity, 'GET', `${base}/limits`)).toHaveLength(1);
      await expect(h1(parity)).toBeFocused();
      // Marcar como obsoleto: alert dialog first.
      await openReady(parity, { 'plans.detail': ['active-3-tenants', 'deprecated'], 'plans.lifecycle': 'success' });
      await button(parity, named(parity, 'deprecate')).click();
      await expect(dialog(parity)).toBeVisible(); expect(writes(parity)).toEqual([]);
      await dialog(parity).getByRole('button', { name: c.dialog.deprecateConfirm, exact: true }).click();
      await expect(button(parity, named(parity, 'archive'))).toBeVisible();
      expect(sent(parity, 'POST', lifecyclePath).map((request) => request.body)).toEqual([{ targetStatus: 'deprecated' }]);
      // Archivar: typed plan name, then archived.
      await openReady(parity, { 'plans.detail': ['deprecated', 'archived'], 'plans.lifecycle': 'success' });
      await button(parity, named(parity, 'archive')).click();
      await expect(dialog(parity).getByRole('button', { name: c.dialog.archiveConfirm, exact: true })).toBeDisabled();
      await typeName(parity);
      await dialog(parity).getByRole('button', { name: c.dialog.archiveConfirm, exact: true }).click();
      await expect(h1(parity)).toBeFocused();
      expect(sent(parity, 'POST', lifecyclePath).map((request) => request.body)).toEqual([{ targetStatus: 'archived' }]);
      // Eliminar: disabled while active, DELETE and redirect for a draft.
      await openReady(parity, { 'plans.detail': 'active-3-tenants' });
      await expect(button(parity, named(parity, 'delete'))).toBeDisabled();
      await openReady(parity, { 'plans.detail': 'draft', 'plans.delete': 'success' });
      await button(parity, named(parity, 'delete')).click();
      await typeName(parity);
      await dialog(parity).getByRole('button', { name: c.dialog.deleteConfirm, exact: true }).click();
      await expect(parity.page).toHaveURL(/\/console\/plans$/);
      expect(sent(parity, 'DELETE', base)).toHaveLength(1);
      // Guardar by keyboard and Restablecer after confirmation.
      await openReady(parity, { 'plans.detail': 'draft', 'plans.limits.set': 'success' });
      await tab(parity, 'limits');
      await input(parity).fill('500'); await input(parity).press('Enter');
      await expect(parity.page.getByText(c.limits.savedTitle, { exact: true })).toBeVisible();
      expect(sent(parity, 'PUT', limitPath).map((request) => request.body)).toEqual([{ value: 500 }]);
      expect(sent(parity, 'GET', `${base}/limits`)).toHaveLength(2);
      await input(parity).fill('7'); await input(parity).press('Escape');
      await input(parity).blur();
      expect(sent(parity, 'PUT', limitPath)).toHaveLength(1);
      await resetButton(parity).click();
      await expect(dialog(parity)).toBeVisible();
      await dialog(parity).getByRole('button', { name: c.dialog.resetConfirm, exact: true }).click();
      await expect(parity.page.getByText(c.limits.resetTitle, { exact: true })).toBeVisible();
      expect(sent(parity, 'DELETE', limitPath)).toHaveLength(1);
      // Retries re-send the identical request.
      await openReady(parity, { 'plans.detail': ['draft', 'active-3-tenants'], 'plans.lifecycle': '500-then-success' });
      await button(parity, named(parity, 'activate')).click();
      await expect(parity.page.getByTestId('mutation-feedback')).toBeVisible();
      await expect(parity.page.getByText(/ahora está|is now/)).toHaveCount(0);
      await parity.page.getByTestId('mutation-feedback').getByRole('button', { name: c.retry, exact: true }).click();
      await expect(button(parity, named(parity, 'deprecate'))).toBeVisible();
      expect(sent(parity, 'POST', lifecyclePath).map((request) => request.body)).toEqual([{ targetStatus: 'active' }, { targetStatus: 'active' }]);
      await openReady(parity, { 'plans.detail': 'draft', 'plans.delete': 'network-then-success' });
      await button(parity, named(parity, 'delete')).click(); await typeName(parity);
      await dialog(parity).getByRole('button', { name: c.dialog.deleteConfirm, exact: true }).click();
      await dialog(parity).getByRole('button', { name: c.retry, exact: true }).click();
      await expect(parity.page).toHaveURL(/\/console\/plans$/);
      expect(sent(parity, 'DELETE', base)).toHaveLength(2);
      await openReady(parity, { 'plans.detail': 'draft', 'plans.limits.set': '500-then-success' });
      await tab(parity, 'limits');
      await input(parity).fill('500'); await saveButton(parity).click();
      await expect(parity.page.getByText(c.limits.rowFailed, { exact: true })).toBeVisible();
      await expect(input(parity)).toHaveValue('5');
      await parity.page.getByTestId('mutation-feedback').getByRole('button', { name: c.retry, exact: true }).click();
      await expect(parity.page.getByText(c.limits.rowSaved, { exact: true })).toBeVisible();
      expect(sent(parity, 'PUT', limitPath).map((request) => request.body)).toEqual([{ value: 500 }, { value: 500 }]);
      await openReady(parity, { 'plans.detail': 'draft', 'plans.limits.remove': 'network-then-success' });
      await tab(parity, 'limits');
      await resetButton(parity).click();
      await dialog(parity).getByRole('button', { name: c.dialog.resetConfirm, exact: true }).click();
      await dialog(parity).getByRole('button', { name: c.retry, exact: true }).click();
      await expect(parity.page.getByText(c.limits.rowReset, { exact: true })).toBeVisible();
      expect(sent(parity, 'DELETE', limitPath)).toHaveLength(2);
      // Load Reintentar re-sends both reads.
      await open(parity, { 'plans.detail': '500-then-success' });
      await parity.page.getByRole('button', { name: c.retry, exact: true }).click();
      await expect(h1(parity)).toHaveText(planName);
      expect(sent(parity, 'GET', base)).toHaveLength(2); expect(sent(parity, 'GET', `${base}/limits`)).toHaveLength(2);
      // After a lifecycle 403 nothing more is sent.
      await openReady(parity, { 'plans.detail': 'draft', 'plans.lifecycle': '403' });
      await button(parity, named(parity, 'activate')).click();
      await expect(parity.page.getByRole('heading', { name: c.feedback.noAccessTitle, exact: true })).toBeVisible();
      await expect(button(parity, named(parity, 'activate'))).toBeDisabled();
      expect(sent(parity, 'POST', lifecyclePath)).toHaveLength(1);
    });

    test('error-empty', async ({ parity }) => {
      const c = copy(parity);
      await check.errorEmpty(parity, manifest);
      await openReady(parity, { 'plans.detail': 'no-description-no-capabilities', 'plans.limits': 'empty' });
      await expect(parity.page.getByText(c.info.noDescription, { exact: true })).toBeVisible();
      await tab(parity, 'capabilities');
      await expect(parity.page.getByRole('heading', { name: c.capabilities.emptyTitle, exact: true })).toBeVisible();
      await tab(parity, 'limits');
      await expect(parity.page.getByRole('heading', { name: c.limits.emptyTitle, exact: true })).toBeVisible();
      await open(parity, { 'plans.detail': 'network' });
      await expect(parity.page.getByRole('button', { name: c.retry, exact: true })).toBeVisible();
      await expect(parity.page.getByRole('heading', { name: planName, exact: true })).toHaveCount(0);
      // Mutation failures keep the persisted data and never show the transport message.
      await openReady(parity, { 'plans.detail': 'draft', 'plans.lifecycle': 'network' });
      await button(parity, named(parity, 'activate')).click();
      await expect(parity.page.getByText(c.feedback.outcomeUnknown, { exact: true })).toBeVisible();
      expect(sent(parity, 'POST', lifecyclePath)).toHaveLength(1);
      await openReady(parity, { 'plans.detail': 'draft', 'plans.lifecycle': '500-unknown-code' });
      await button(parity, named(parity, 'activate')).click();
      await expect(parity.page.getByTestId('mutation-feedback')).toContainText('PLAN_SYNTHETIC_FAILURE');
      await expect(parity.page.locator('main')).not.toContainText('PRIVATE_MARKER');
      await openReady(parity, { 'plans.detail': 'draft', 'plans.delete': '403' });
      await button(parity, named(parity, 'delete')).click(); await typeName(parity);
      await dialog(parity).getByRole('button', { name: c.dialog.deleteConfirm, exact: true }).click();
      await expect(dialog(parity).getByRole('heading', { name: c.feedback.noAccessTitle, exact: true })).toBeVisible();
      await openReady(parity, { 'plans.detail': 'draft', 'plans.delete': '409-assignment-history' });
      await button(parity, named(parity, 'delete')).click(); await typeName(parity);
      await dialog(parity).getByRole('button', { name: c.dialog.deleteConfirm, exact: true }).click();
      await expect(dialog(parity).getByText(c.feedback.code.PLAN_HAS_ASSIGNMENT_HISTORY, { exact: true })).toBeVisible();
      for (const [variant, code] of [['400-invalid-limit', 'INVALID_LIMIT_VALUE'], ['409-frozen', 'PLAN_LIMITS_FROZEN'], ['403', null]]) {
        await openReady(parity, { 'plans.detail': 'draft', 'plans.limits.set': variant });
        await tab(parity, 'limits');
        await input(parity).fill('500'); await saveButton(parity).click();
        await expect(input(parity)).toHaveValue('5');
        if (code) await expect(parity.page.getByText(c.feedback.code[code], { exact: true })).toBeVisible();
        else await expect(parity.page.getByRole('heading', { name: c.feedback.noAccessTitle, exact: true })).toBeVisible();
      }
      await openReady(parity, { 'plans.detail': 'draft', 'plans.limits.remove': '500' });
      await tab(parity, 'limits');
      await resetButton(parity).click();
      await dialog(parity).getByRole('button', { name: c.dialog.resetConfirm, exact: true }).click();
      await expect(dialog(parity).getByRole('button', { name: c.retry, exact: true })).toBeVisible();
      await open(parity, { 'plans.detail': 'draft', 'plans.limits': '500-then-success' });
      await expect(parity.page.getByRole('heading', { name: c.load.errorTitle, exact: true })).toBeVisible();
    });

    test('accessibility', async ({ parity }) => {
      const c = copy(parity);
      await openReady(parity, { 'plans.detail': 'active-3-tenants' });
      for (const key of ['info', 'capabilities', 'limits', 'assignments']) {
        await tab(parity, key);
        await check.assertAccessibility(parity);
      }
      await tab(parity, 'limits');
      await expect(input(parity)).toBeVisible();
      await expect(input(parity)).toHaveAttribute('aria-describedby', /limit-max_workspaces-help/);
      await resetButton(parity).click();
      await expect(dialog(parity)).toBeVisible();
      await check.assertAccessibility(parity);
      await dialog(parity).getByRole('button', { name: c.dialog.cancel, exact: true }).click();
      await expect(resetButton(parity)).toBeFocused();
      await openReady(parity, { 'plans.detail': 'draft', 'plans.delete': '403' });
      await button(parity, named(parity, 'delete')).click(); await typeName(parity);
      await check.assertAccessibility(parity);
      await dialog(parity).getByRole('button', { name: c.dialog.deleteConfirm, exact: true }).click();
      await expect(dialog(parity).getByTestId('mutation-feedback')).toBeFocused();
      await check.assertAccessibility(parity);
      await open(parity, { 'plans.detail': '500-then-success' });
      await expect(parity.page.getByTestId('load-error')).toBeFocused();
      await check.assertAccessibility(parity);
      await parity.page.getByRole('button', { name: c.retry, exact: true }).click();
      await expect(h1(parity)).toBeFocused();
      await openReady(parity, { 'plans.detail': ['draft', 'active-3-tenants'], 'plans.lifecycle': '500-then-success' });
      await button(parity, named(parity, 'activate')).click();
      await expect(parity.page.getByTestId('mutation-feedback')).toBeFocused();
      await check.assertAccessibility(parity);
      await parity.page.getByTestId('mutation-feedback').getByRole('button', { name: c.retry, exact: true }).click();
      await expect(h1(parity)).toBeFocused();
    });

    test('kit-conformance', async () => { await check.kitConformance(manifest); });

    test('runtime-health', async ({ parity }) => {
      await openReady(parity, { 'plans.detail': 'draft' });
      await check.assertRuntimeHealth(parity);
      await openReady(parity, { 'plans.detail': ['draft', 'active-3-tenants'], 'plans.lifecycle': 'success' });
      await button(parity, named(parity, 'activate')).click();
      await expect(button(parity, named(parity, 'deprecate'))).toBeVisible();
      await check.assertRuntimeHealth(parity);
      await openReady(parity, { 'plans.detail': 'draft', 'plans.delete': 'success' });
      await button(parity, named(parity, 'delete')).click(); await typeName(parity);
      await dialog(parity).getByRole('button', { name: copy(parity).dialog.deleteConfirm, exact: true }).click();
      await expect(parity.page).toHaveURL(/\/console\/plans$/);
      await check.assertRuntimeHealth(parity);
      await openReady(parity, { 'plans.detail': 'draft', 'plans.limits.set': 'success' });
      await tab(parity, 'limits');
      await input(parity).fill('500'); await saveButton(parity).click();
      await expect(parity.page.getByText(copy(parity).limits.savedTitle, { exact: true })).toBeVisible();
      await check.assertRuntimeHealth(parity);
    });

    test('responsive', async ({ parity }) => {
      await openReady(parity, { 'plans.detail': 'active-3-tenants' });
      for (const size of [375, 768, 1280]) await check.assertResponsive(parity, size);
      await parity.page.setViewportSize({ width, height: 900 });
      await tab(parity, 'limits');
      await check.assertResponsive(parity, width);
      await expect(input(parity)).toBeVisible();
      // The error panel fits the delete dialog at every width.
      await openReady(parity, { 'plans.detail': 'draft', 'plans.delete': 'network' });
      await button(parity, named(parity, 'delete')).click(); await typeName(parity);
      await dialog(parity).getByRole('button', { name: copy(parity).dialog.deleteConfirm, exact: true }).click();
      await expect(dialog(parity).getByTestId('mutation-feedback')).toBeVisible();
      await check.assertResponsive(parity, width);
    });

    test('visual-review', async ({ parity }, info) => {
      for (const [name, variants] of [
        ['draft', { 'plans.detail': 'draft' }], ['active-3-tenants', { 'plans.detail': 'active-3-tenants' }],
        ['deprecated', { 'plans.detail': 'deprecated' }], ['archived', { 'plans.detail': 'archived' }],
        ['load-500', { 'plans.detail': '500' }],
      ]) {
        if (name === 'load-500') await open(parity, variants); else await openReady(parity, variants);
        await snapshot(parity, info, name);
        if (name === 'active-3-tenants') for (const key of ['capabilities', 'limits', 'assignments']) { await tab(parity, key); await snapshot(parity, info, `${name}-${key}`); }
      }
      await openReady(parity, { 'plans.detail': 'draft', 'plans.limits.set': '400-invalid-limit' });
      await tab(parity, 'limits'); await input(parity).fill('500'); await saveButton(parity).click();
      await expect(parity.page.getByText(copy(parity).feedback.code.INVALID_LIMIT_VALUE, { exact: true })).toBeVisible();
      await snapshot(parity, info, 'limits.set-400-invalid-limit');
      await openReady(parity, { 'plans.detail': 'draft', 'plans.limits.set': 'success' });
      await tab(parity, 'limits'); await input(parity).fill('500'); await saveButton(parity).click();
      await expect(parity.page.getByText(copy(parity).limits.savedTitle, { exact: true })).toBeVisible();
      await snapshot(parity, info, 'limits.set-success');
      await openReady(parity, { 'plans.detail': 'draft' });
      await tab(parity, 'limits'); await resetButton(parity).click();
      await expect(dialog(parity)).toBeVisible();
      await snapshot(parity, info, 'reset-dialog');
      await openReady(parity, { 'plans.detail': 'draft', 'plans.lifecycle': '500' });
      await button(parity, named(parity, 'activate')).click();
      await expect(parity.page.getByTestId('mutation-feedback')).toBeVisible();
      await snapshot(parity, info, 'lifecycle-500');
      await openReady(parity, { 'plans.detail': 'deprecated' });
      await button(parity, named(parity, 'archive')).click();
      await expect(dialog(parity)).toBeVisible();
      await snapshot(parity, info, 'archive-dialog');
      await openReady(parity, { 'plans.detail': 'draft', 'plans.delete': 'network' });
      await button(parity, named(parity, 'delete')).click(); await typeName(parity);
      await dialog(parity).getByRole('button', { name: copy(parity).dialog.deleteConfirm, exact: true }).click();
      await expect(dialog(parity).getByTestId('mutation-feedback')).toBeVisible();
      await snapshot(parity, info, 'delete-network');
      await openReady(parity, { 'plans.detail': 'draft', 'plans.delete': '403' });
      await button(parity, named(parity, 'delete')).click(); await typeName(parity);
      await dialog(parity).getByRole('button', { name: copy(parity).dialog.deleteConfirm, exact: true }).click();
      await expect(dialog(parity).getByTestId('mutation-feedback')).toBeVisible();
      await snapshot(parity, info, 'delete-403');
      // Artifacts are evidence for the independent checker and the operator's visual approval.
    });
  });
}

for (const role of ['member', 'tenant_owner', 'platform_auditor']) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`Plan detail permission denial ${role} ${locale} ${width}`, () => {
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test('denies access without a plan request', async ({ parity, server }) => {
      parity.network.setVariants({ tenants: 'empty' });
      await parity.page.goto(server.url(`console/plans/${planId}`));
      await expect(parity.page.getByText(locale === 'es' ? 'Acceso denegado' : 'Access denied', { exact: true })).toBeVisible();
      expect(parity.network.requests.filter((request) => request.path.startsWith('/v1/plans/'))).toHaveLength(0);
      await check.assertRuntimeHealth(parity);
    });
  });
}
