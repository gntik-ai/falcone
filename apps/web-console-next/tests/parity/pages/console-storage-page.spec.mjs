import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import manifest, { bucket, createPath, deletePath, exportPath, metadataPath, objectsPath, presignPath, uploadPath } from './console-storage-page.manifest.ts';
import { installStorageHarness } from './console-storage-page.support.mjs';

const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-storage-page.json`, import.meta.url), 'utf8'))]));
const c = (parity) => bundles[parity.locale];
const named = (copy, values) => copy.replace(/\{(\w+)\}/g, (_, key) => values[key]);
const button = (parity, key, scope = parity.page) => scope.getByRole('button', { name: c(parity)[key], exact: true });
const rowAction = (parity, key) => parity.page.getByRole('button', { name: named(c(parity)[key], { name: bucket.bucketName }), exact: true });
const ready = async (parity) => expect(parity.page.getByRole('button', { name: bucket.bucketName, exact: true })).toBeVisible();
async function selectBucket(parity) { await ready(parity); await parity.page.getByRole('button', { name: bucket.bucketName, exact: true }).click(); await expect(parity.page.getByRole('button', { name: 'media/hero.png', exact: true })).toBeVisible(); }
async function selectObject(parity) { await selectBucket(parity); await parity.page.getByRole('button', { name: 'media/hero.png', exact: true }).click(); await expect(parity.page.getByText('abcdef1234567890abcdef1234567890')).toBeVisible(); }
async function create(parity, name = 'media') { await button(parity, 'newBucket').click(); await parity.page.getByLabel(c(parity).bucketName, { exact: true }).fill(name); await button(parity, 'create').click(); }
async function upload(parity) { await button(parity, 'uploadObject').click(); await parity.page.getByLabel(c(parity).uploadFile, { exact: true }).setInputFiles({ name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }); await button(parity, 'upload').click(); }
async function remove(parity) { await rowAction(parity, 'deleteBucket').click(); await parity.page.getByLabel(c(parity).typedName, { exact: true }).fill(bucket.bucketName); await button(parity, 'delete', parity.page.getByRole('alertdialog')).click(); }
async function activate(parity, name) {
  if (['buckets', 'usage'].includes(name)) return;
  if (name === 'create') return create(parity);
  if (name === 'export') return rowAction(parity, 'exportBucket').click();
  if (name === 'delete') return remove(parity);
  if (name === 'objects') { await ready(parity); return parity.page.getByRole('button', { name: bucket.bucketName, exact: true }).click(); }
  if (name === 'metadata') { await selectBucket(parity); return parity.page.getByRole('button', { name: 'media/hero.png', exact: true }).click(); }
  if (name === 'upload') { await selectBucket(parity); return upload(parity); }
  await selectObject(parity); await parity.page.getByRole('tab', { name: c(parity).presigned, exact: true }).click(); await button(parity, 'generate').click();
}
async function capture(parity, info, name) {
  const body = await parity.page.locator('main').screenshot({ animations: 'disabled', caret: 'hide', mask: [parity.page.getByTestId('storage-presigned-result')] });
  await info.attach(`${name}-${parity.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}
// Returned presigned values must never enter automatic traces, video or failure screenshots.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) test.describe(`console-storage-page | ${locale} | ${width}`, () => {
  test.use({ role: 'superadmin', locale, viewport: { width, height: 900 }, pageEndpoints: {} });
  let harness;
  test.beforeEach(async ({ parity }) => { harness = await installStorageHarness(parity); });
  test.afterEach(async ({ parity }) => {
    expect(harness.unmatched).toEqual([]);
    expect(harness.calls.some(({ path }) => /\/imports|\/clone|\/tenants\/.*\/exports|\/exports\//.test(path))).toBe(false);
    await check.assertRuntimeHealth(parity);
  });
  test('data', async ({ parity }) => {
    await harness.open(); await ready(parity); await expect(parity.page.getByText('other-workspace', { exact: true })).toHaveCount(0);
    await expect(parity.page.getByRole('meter')).toHaveAttribute('aria-valuenow', '50'); await selectObject(parity);
    await expect(parity.page.getByText('design', { exact: true })).toBeVisible(); await expect(parity.page.getByText('es-ES', { exact: true })).toBeVisible();
    await expect(parity.page.getByRole('list', { name: c(parity).history })).toBeVisible(); await check.assertLocale(parity);
  });
  test('action', async ({ parity }) => {
    await harness.open(); await ready(parity); await create(parity, '  Mi Bucket  ');
    await expect.poll(() => harness.calls.filter(({ name }) => name === 'create')).toEqual([{ name: 'create', method: 'POST', path: createPath, body: { name: 'Mi Bucket' } }]);
    await expect(button(parity, 'newBucket')).toBeVisible(); await selectObject(parity); await button(parity, 'next').click(); await expect(parity.page.getByRole('button', { name: 'media/manual.pdf' })).toBeVisible();
    await upload(parity); await expect.poll(() => harness.calls.filter(({ name }) => name === 'upload').map(({ body }) => body)).toEqual([{ content: 'aGVsbG8=', contentType: 'text/plain', encoding: 'base64' }]);
    const downloadPromise = parity.page.waitForEvent('download'); await rowAction(parity, 'exportBucket').click(); const download = await downloadPromise; expect(download.suggestedFilename()).toBe('manifest-synthetic.json');
    await rowAction(parity, 'deleteBucket').click(); await expect(button(parity, 'delete', parity.page.getByRole('alertdialog'))).toBeDisabled(); await parity.page.getByLabel(c(parity).typedName).fill(`${bucket.bucketName} `); await expect(button(parity, 'delete', parity.page.getByRole('alertdialog'))).toBeDisabled(); await parity.page.getByLabel(c(parity).typedName).fill(bucket.bucketName); await button(parity, 'delete', parity.page.getByRole('alertdialog')).click();
    await expect.poll(() => harness.calls.filter(({ name }) => name === 'delete').length).toBe(1);
    await selectObject(parity); await parity.page.getByRole('tab', { name: c(parity).presigned, exact: true }).click(); await button(parity, 'generate').click(); await expect(parity.page.getByTestId('storage-presigned-result')).toBeVisible();
    expect(harness.calls.filter(({ name }) => name === 'presign').map(({ body }) => body)).toEqual([{ operation: 'download', ttlSeconds: 300 }]);
    await parity.page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (code) => { window.__storageCopied = code; } } }); });
    await button(parity, 'copy').first().click(); expect(await parity.page.evaluate(() => window.__storageCopied)).toBe(`aws --endpoint-url <RESOURCE_HOST> s3 ls s3://${bucket.bucketName} --region eu-west-1`);
    await parity.page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }); }); await button(parity, 'copy').first().click(); await expect(parity.page.getByText(c(parity).clipboardUnavailable)).toBeVisible();
  });
  test('error-empty', async ({ parity }) => {
    test.slow();
    for (const section of ['buckets', 'usage', 'objects', 'metadata', 'presign', 'create', 'upload', 'export', 'delete']) for (const status of ['403', '404', '500', 'network']) {
      await harness.open({ [section]: status }); await activate(parity, section); const panel = parity.page.getByTestId(`storage-failure-${section}`); await expect(panel).toBeVisible();
      if (status === '500' || status === 'network') { harness.set({}); await button(parity, 'retry', panel).click(); await expect(panel).toHaveCount(0); }
    }
    for (const section of ['buckets', 'usage', 'objects', 'metadata', 'presign', 'create', 'upload', 'export', 'delete']) {
      await harness.open({ [section]: 'delayed' }); await activate(parity, section);
      const pendingLabel = ['create', 'upload', 'delete'].includes(section) ? c(parity)[section === 'create' ? 'creating' : section === 'upload' ? 'uploading' : 'deleting'] : section === 'presign' ? c(parity).generating : section === 'export' ? c(parity).exporting : c(parity).loading;
      if (['create', 'upload', 'delete', 'presign'].includes(section)) await expect(parity.page.getByRole('button', { name: pendingLabel, exact: true })).toBeVisible();
      else await expect(parity.page.getByRole('status', { name: pendingLabel }).first()).toBeVisible();
      await expect.poll(() => harness.calls.filter(({ name }) => name === section).length).toBe(1);
      await parity.page.waitForTimeout(1550);
    }
    await harness.open({ next: 'delayed' }); await selectBucket(parity); await button(parity, 'next').click(); await expect(parity.page.getByRole('button', { name: 'media/hero.png', exact: true })).toBeVisible(); await expect(button(parity, 'loading')).toBeDisabled(); await expect(parity.page.getByRole('button', { name: 'media/manual.pdf', exact: true })).toBeVisible();
    await harness.open({ buckets: 'noHistory' }); await selectBucket(parity); await expect(parity.page.getByRole('heading', { name: c(parity).noHistory })).toBeVisible();
    await harness.open({ metadata: 'noCustom' }); await selectBucket(parity); await parity.page.getByRole('button', { name: 'media/hero.png', exact: true }).click(); await expect(parity.page.getByText(c(parity).noCustomMetadata)).toBeVisible();
    await harness.open(); await selectBucket(parity); await parity.page.getByRole('tab', { name: c(parity).presigned, exact: true }).click(); await expect(parity.page.getByText(c(parity).selectObject)).toBeVisible();
    await harness.open({ buckets: 'empty' }); await expect(parity.page.getByRole('heading', { name: c(parity).noBuckets })).toBeVisible();
    await harness.open({ objects: 'empty' }); await ready(parity); await parity.page.getByRole('button', { name: bucket.bucketName, exact: true }).click(); await expect(button(parity, 'uploadFirst')).toBeVisible();
    for (const variant of ['unavailable', 'noQuota', 'noBreakdown']) { await harness.open({ usage: variant }); await ready(parity); await expect(parity.page.getByText(c(parity)[variant === 'unavailable' ? 'providerUnavailable' : variant === 'noQuota' ? 'noQuota' : 'noBreakdown'])).toBeVisible(); }
    await harness.open({}, { noTenant: true }); await expect(parity.page.getByText(c(parity).noTenant)).toBeVisible();
    await harness.open({}, { workspaces: 'none' }); await expect(parity.page.getByRole('heading', { name: c(parity).workspaceRequired })).toBeVisible();
  });
  test('accessibility', async ({ parity }) => {
    test.slow();
    await harness.open(); await ready(parity); await button(parity, 'newBucket').click(); await expect(parity.page.getByLabel(c(parity).bucketName, { exact: true })).toBeFocused(); await selectObject(parity); await button(parity, 'uploadObject').click(); await expect(parity.page.getByLabel(c(parity).uploadKey, { exact: true })).toBeFocused();
    const objectsTab = parity.page.getByRole('tab', { name: c(parity).objects, exact: true }); await objectsTab.focus(); await parity.page.keyboard.press('ArrowRight'); await expect(parity.page.getByRole('tab', { name: c(parity).presigned, exact: true })).toBeFocused(); await parity.page.keyboard.press('ArrowRight'); await expect(parity.page.getByRole('heading', { name: c(parity).unsupported })).toBeVisible(); await check.assertAccessibility(parity);
    for (const action of ['create', 'upload', 'export', 'delete']) for (const status of ['403', '404', '500', 'network']) { await harness.open({ [action]: status }); await activate(parity, action); await expect(parity.page.getByTestId(`storage-failure-${action}`)).toBeVisible(); await check.assertAccessibility(parity); }
    await check.assertLocale(parity);
  });
  test('runtime-health', async ({ parity }) => {
    test.slow();
    for (const section of ['buckets', 'usage', 'objects', 'metadata', 'presign', 'create', 'upload', 'export', 'delete']) {
      await harness.open({ [section]: '401' }); await activate(parity, section); await expect.poll(() => harness.calls.filter(({ name }) => name === section).length).toBe(2);
    }
    for (const variant of ['normalized', 'incomplete', 'pre-existing', 'conclusive', 'unnamed']) {
      await harness.open({ create: 'network', buckets: ['success', ['unnamed', 'pre-existing'].includes(variant) ? 'success' : variant] }); await ready(parity);
      await create(parity, variant === 'normalized' ? 'Mi Bucket' : variant === 'unnamed' ? '' : variant === 'pre-existing' ? 'media-assets' : 'media');
      const panel = parity.page.getByTestId('storage-failure-create'); await button(parity, 'retry', panel).click();
      await expect(parity.page.getByText(variant === 'conclusive' ? named(c(parity).created, { name: 'media' }) : c(parity).outcomeUnknown)).toBeVisible(); expect(harness.calls.filter(({ name }) => name === 'create')).toHaveLength(1);
    }
    for (const kind of ['workspace', 'tenant']) for (const action of ['create', 'upload', 'export', 'delete']) {
      await harness.open({}, { workspaces: kind }); await selectObject(parity);
      await parity.page.getByRole('tab', { name: c(parity).presigned, exact: true }).click(); await button(parity, 'generate').click(); await expect(parity.page.getByTestId('storage-presigned-result')).toBeVisible();
      await parity.page.getByRole('tab', { name: c(parity).objects, exact: true }).click(); harness.set({ [action]: { variant: 'success', delayMs: 1200 } });
      if (action === 'upload') await upload(parity); else if (action === 'create') await create(parity); else if (action === 'export') await rowAction(parity, 'exportBucket').click(); else await remove(parity);
      await expect.poll(() => harness.calls.filter(({ name }) => name === action).length).toBe(1);
      harness.set({ buckets: 'otherContext' });
      // Programmatic shell activation simulates an external context change while a modal holds focus.
      await parity.page.locator('button').filter({ hasText: kind === 'tenant' ? 'Synthetic Tenant' : 'Synthetic Workspace' }).first().evaluate((node) => node.click());
      await parity.page.locator('[role="menuitemradio"]').filter({ hasText: kind === 'tenant' ? 'Other Tenant' : 'Other Workspace' }).evaluate((node) => node.click());
      await expect(parity.page.getByRole('button', { name: 'other-context', exact: true })).toBeVisible(); await expect(parity.page.getByRole('alertdialog')).toHaveCount(0); await expect(parity.page.getByTestId('storage-presigned-result')).toHaveCount(0); await expect(parity.page.getByRole('heading', { level: 1 })).toBeFocused();
      await parity.page.waitForTimeout(1300); expect(harness.calls.filter(({ name }) => name === action)).toHaveLength(1); expect(harness.calls.filter(({ name }) => name === 'buckets')).toHaveLength(2);
    }
    await harness.open({ buckets: '401' }, { refreshRejected: true }); await expect(parity.page).toHaveURL(/\/login$/);
    await check.assertRuntimeHealth(parity);
  });
  test('responsive', async ({ parity }) => {
    await harness.open(); await selectObject(parity); await check.assertResponsive(parity, width); await harness.open({ create: '500' }); await ready(parity); await create(parity); await expect(parity.page.getByTestId('storage-failure-create')).toBeVisible(); await check.assertResponsive(parity, width);
  });
  test('visual-review', async ({ parity }, info) => {
    await harness.open(); await ready(parity); await capture(parity, info, 'buckets-and-usage'); await selectObject(parity); await capture(parity, info, 'objects-history');
    await button(parity, 'newBucket').click(); await button(parity, 'uploadObject').click(); await capture(parity, info, 'create-upload');
    await parity.page.getByRole('tab', { name: c(parity).presigned, exact: true }).click(); await button(parity, 'generate').click(); await expect(parity.page.getByTestId('storage-presigned-result')).toBeVisible(); await capture(parity, info, 'presigned-masked');
    await parity.page.getByRole('tab', { name: c(parity).multipart, exact: true }).click(); await capture(parity, info, 'multipart');
    await rowAction(parity, 'deleteBucket').click(); await capture(parity, info, 'delete-confirmation');
    for (const action of ['create', 'delete']) for (const status of ['403', '500']) { await harness.open({ [action]: status }); await activate(parity, action); await expect(parity.page.getByTestId(`storage-failure-${action}`)).toBeVisible(); await capture(parity, info, `${action}-${status}`); }
  });
  test('kit-conformance', async ({ parity }) => {
    await harness.open(); await selectObject(parity); await check.assertLocale(parity);
    const sources = [new URL('../../../src/pages/consoleStorage.tsx', import.meta.url), ...['States.tsx', 'Dialogs.tsx', 'Detail.tsx', 'Usage.tsx', 'Snippets.tsx', 'page.css'].map((name) => new URL(`../../../src/pages/consoleStorage/${name}`, import.meta.url))];
    for (const source of sources) expect(readFileSync(source, 'utf8')).not.toMatch(/#[0-9a-f]{3,8}\b|(?:bg|text|border)-(?:white|black|yellow-500|emerald-\d+)|(?:bg|text)-\[/i);
  });
});
