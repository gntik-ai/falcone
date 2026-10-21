import { createHash } from 'node:crypto';
import manifest, { bodyFor, entries, operation } from './operationDetail.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';

const copy = (parity, es, en) => parity.locale === 'es' ? es : en;
const next = (parity) => parity.page.getByRole('button', { name: copy(parity, 'Siguiente', 'Next'), exact: true });
const previous = (parity) => parity.page.getByRole('button', { name: copy(parity, 'Anterior', 'Previous'), exact: true });
const resultTab = (parity) => parity.page.getByRole('tab', { name: copy(parity, 'Resultado', 'Result'), exact: true });
const retry = (parity) => parity.page.getByRole('button', { name: copy(parity, 'Reintentar', 'Retry'), exact: true });
const recovery = (parity, section) => parity.page.getByRole('heading', { name: copy(parity, ...section), exact: true, level: 2 });

for (const role of manifest.roles) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`operationDetail | ${role} | ${locale} | ${width}`, () => {
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test.beforeEach(async ({ parity }) => {
      const open = parity.open.bind(parity);
      parity.open = async (...args) => {
        await open(...args);
        await expect(parity.page.locator('.operation-detail [aria-busy="true"]')).toHaveCount(0);
      };
    });
    test('data', async ({ parity }) => {
      await check.data(parity, manifest);
      await expect(parity.page.locator('.operation-metadata dt')).toHaveCount(8);
      await expect(parity.page.getByRole('list', { name: copy(parity, 'Cronología', 'Timeline') }).locator('li')).toHaveCount(3);
      for (const queryType of ['detail', 'logs', 'result']) expect(parity.network.requests).toContainEqual({ method: 'POST', path: '/v1/async-operation-query', body: bodyFor(queryType) });
      for (const [status, es, en] of [['pending', 'Pendiente', 'Pending'], ['running', 'En curso', 'Running'], ['completed', 'Completada', 'Completed'], ['failed', 'Fallida', 'Failed'], ['timed_out', 'Expirada', 'Timed out'], ['cancelled', 'Cancelada', 'Cancelled']]) {
        await parity.open(manifest.route, { 'ops.detail': status });
        await expect(parity.page.locator('main').getByText(copy(parity, es, en), { exact: true }).first()).toBeVisible();
      }
    });
    test('action', async ({ parity }) => {
      await check.action(parity, manifest);
      await parity.open(manifest.route);
      await expect(previous(parity)).toBeDisabled();
      await next(parity).click();
      await expect(parity.page.getByText(entries[20].message, { exact: true })).toBeVisible();
      await next(parity).click();
      await expect(parity.page.getByText(entries[40].message, { exact: true })).toBeVisible();
      await expect(next(parity)).toBeDisabled();
      await expect(parity.page.locator('.operation-detail button[aria-current="page"]')).toBeFocused();
      // Copy does not navigate or lose focus and its live feedback is translated.
      await parity.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      const copyButton = parity.page.locator('.operation-metadata dd').filter({ hasText: operation.correlationId }).getByRole('button');
      await expect(copyButton).toHaveAccessibleName(copy(parity, 'Copiar ID de correlación', 'Copy Correlation ID'));
      await copyButton.click();
      await expect(copyButton).toBeFocused();
      await expect(copyButton).toHaveAccessibleName(copy(parity, 'Copiado: ID de correlación', 'Copied: Correlation ID'));
      for (const [endpoint, variant, section, queryType] of [
        ['ops.logs', '500-then-success', ['Registros resumidos', 'Summarized logs'], 'logs'],
        ['ops.detail', '500-then-success', ['Metadatos', 'Metadata'], 'detail'],
        ['ops.result', 'network-then-success', ['Resultado', 'Result'], 'result'],
      ]) {
        await parity.open(manifest.route, { [endpoint]: variant });
        if (queryType === 'result') await resultTab(parity).click();
        await expect(retry(parity)).toBeVisible();
        const start = parity.network.requests.length;
        await retry(parity).click();
        await expect(recovery(parity, section)).toBeFocused();
        expect(parity.network.requests.slice(start)).toContainEqual({ method: 'POST', path: '/v1/async-operation-query', body: bodyFor(queryType) });
      }
      await parity.open(manifest.route);
      parity.network.setVariants({ 'ops.logs': ['500', '500', '500', 'success'] });
      await next(parity).click();
      await expect(retry(parity)).toBeVisible();
      await expect(parity.page.getByText(entries[0].message, { exact: true })).toHaveCount(0);
      await retry(parity).click();
      await expect(parity.page.getByText(entries[20].message, { exact: true })).toBeVisible();
      expect(parity.network.requests.at(-1)).toEqual({ method: 'POST', path: '/v1/async-operation-query', body: bodyFor('logs', 20) });
      await parity.page.getByRole('link', { name: copy(parity, 'Volver a operaciones', 'Back to operations'), exact: true }).click();
      await expect(parity.page).toHaveURL(/\/console\/operations$/);
    });
    test('error-empty', async ({ parity }) => {
      await check.errorEmpty(parity, manifest);
      await parity.open(manifest.route, { 'ops.detail': 'empty' });
      await expect(parity.page.getByText(copy(parity, 'Operación no encontrada o no disponible.', 'Operation not found or unavailable.'), { exact: true })).toBeVisible();
      await parity.open(manifest.route, { 'ops.logs': '500', 'ops.result': 'failure-retryable' });
      await expect(parity.page.getByText('synthetic-workspace-create', { exact: true })).toBeVisible();
      await expect(retry(parity)).toBeVisible();
      await expect(parity.page.getByText('synthetic-request', { exact: true })).toBeVisible();
      await resultTab(parity).click();
      await expect(parity.page.getByText('Synthetic failure reason', { exact: true })).toBeVisible();
      await expect(parity.page.getByText(copy(parity, 'Esta operación puede reintentarse.', 'This operation can be retried.'), { exact: true })).toBeVisible();
      await parity.open(manifest.route, { 'ops.result': 'pending' });
      await resultTab(parity).click();
      await expect(parity.page.getByText(copy(parity, 'La operación aún está en curso.', 'The operation is still in progress.'), { exact: true })).toBeVisible();
      await parity.open(manifest.route, { 'ops.detail': '401' });
      await expect(parity.page).toHaveURL(/\/login$/);
      // Observe actual skeletons before delayed responses settle.
      await parity.open(manifest.route);
      parity.network.setVariants({ 'ops.detail': { delayMs: 1000 }, 'ops.logs': { delayMs: 1000 }, 'ops.result': { delayMs: 1000 } });
      await parity.page.reload();
      await expect(parity.page.getByText(copy(parity, 'Cargando metadatos.', 'Loading metadata.'), { exact: true })).toHaveCount(1);
      await expect(parity.page.getByText(copy(parity, 'Cargando cronología.', 'Loading timeline.'), { exact: true })).toHaveCount(1);
    });
    test('accessibility', async ({ parity }) => {
      for (const variants of [{}, { 'ops.logs': 'empty' }, { 'ops.detail': '403' }, { 'ops.detail': '404' }, { 'ops.detail': '500' }, { 'ops.logs': 'network' }]) {
        await parity.open(manifest.route, variants);
        await check.assertAccessibility(parity);
        await check.assertLocale(parity);
      }
      await parity.open(manifest.route);
      await parity.page.getByRole('tab', { name: copy(parity, 'Registros resumidos', 'Summarized logs') }).focus();
      await parity.page.keyboard.press('ArrowRight');
      await parity.page.keyboard.press('Enter');
      await expect(resultTab(parity)).toHaveAttribute('aria-selected', 'true');
      await check.assertAccessibility(parity);
    });
    test('runtime-health', async ({ parity }) => {
      await parity.open(manifest.route, { 'ops.logs': '500-then-success' });
      await expect(retry(parity)).toBeVisible();
      await retry(parity).click();
      await expect(parity.page.getByText(entries[0].message, { exact: true })).toBeVisible();
      await next(parity).click();
      await expect(parity.page.getByText(entries[20].message, { exact: true })).toBeVisible();
      await resultTab(parity).click();
      await check.assertRuntimeHealth(parity);
      // Both negatives must still fail in the presence of tolerated HTTP resource errors.
      for (const fault of ['console.error', 'unhandledrejection']) {
        const start = parity.faults.length;
        await parity.page.evaluate((fault) => {
          if (fault === 'console.error') console.error('synthetic-console-error');
          else Promise.reject(new Error('synthetic-rejection'));
        }, fault);
        await expect.poll(() => parity.faults.length).toBeGreaterThan(start);
        await expect(check.assertRuntimeHealth({ ...parity, faults: parity.faults.slice(start) })).rejects.toThrow(/runtime-health/);
      }
    });
    test('responsive', async ({ parity }) => {
      await parity.open(manifest.route);
      await check.assertResponsive(parity, width);
      await next(parity).click();
      await expect(parity.page.getByText(entries[20].message, { exact: true })).toBeVisible();
      await check.assertResponsive(parity, width);
    });
    test('visual-review', async ({ parity }, info) => {
      // Capture review artifacts; a self-comparison is not operator approval.
      for (const [state, variants, showResult] of [
        ['completed', {}, false], ['failed', { 'ops.result': 'failure-retryable' }, true],
        ['pending', { 'ops.result': 'pending' }, true], ['not-found', { 'ops.detail': '404' }, false],
        ['error', { 'ops.detail': '500' }, false],
      ]) {
        await parity.open(manifest.route, variants);
        if (showResult) await resultTab(parity).click();
        await check.assertLocale(parity);
        const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
        const sha256 = createHash('sha256').update(body).digest('hex');
        await info.attach(`${state}-${locale}-${width}-sha256-${sha256}`, { body, contentType: 'image/png' });
      }
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
  });
}
