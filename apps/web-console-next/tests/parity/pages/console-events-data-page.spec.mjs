import manifest, { topics, topicsPath, publishPath, messagesPath } from './console-events-data-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { copy, assertEventsLocale } from './console-events-data-page.locale.mjs';
import { button, eventCalls, field, radio, ready, screenshot, surface, trackInjectedErrors } from './console-events-data-page.support.mjs';
import { seedHistoryPrincipal } from './console-flow-history-page.session.mjs';
const messagesQuery = `${messagesPath}?maxMessages=10`;
for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-events-data-page | superadmin | ${locale} | ${width}`, () => {
    test.use({ role: 'superadmin', locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test.beforeEach(async ({ parity }) => trackInjectedErrors(parity));
    test('data', { tag: '@legacy-parity' }, async ({ parity }) => {
      await parity.open(manifest.route); await ready(parity);
      await expect(surface(parity).getByRole('heading', { name: copy(parity).listTitle.replace('{count}', '3'), exact: true })).toBeVisible();
      for (const topic of topics.items) {
        const row = surface(parity).getByRole('row').filter({ hasText: topic.topic });
        await expect(row).toBeVisible(); if (topic.partitions != null) await expect(row).toContainText(String(topic.partitions));
      }
      await radio(parity).check(); await button(parity, 'consume').click();
      for (const index of [1, 2]) await expect(surface(parity).getByRole('tree', { name: copy(parity).messageValue.replace('{index}', String(index)), exact: true })).toBeVisible();
      for (const text of [copy(parity).messageKey.replace('{key}', 'synthetic-key'), copy(parity).messagePartition.replace('{partition}', '0'), copy(parity).messageOffset.replace('{offset}', '42'), '2026-06-01T12:00:00Z']) await expect(surface(parity).getByText(text, { exact: true })).toBeVisible();
      expect(eventCalls(parity)).toEqual([{ method: 'GET', path: topicsPath, body: undefined }, { method: 'GET', path: messagesQuery, body: undefined }]);
      await assertEventsLocale(parity);
    });
    test('action', { tag: '@legacy-parity' }, async ({ parity }) => {
      await parity.open(manifest.route, { 'events-topics': ['success-three', 'created'] }); await ready(parity);
      await radio(parity).check(); await field(parity, 'messageJson').fill('{'); await button(parity, 'publish').click();
      await expect(surface(parity).getByText(copy(parity).invalidJson, { exact: true })).toBeVisible(); await expect(field(parity, 'messageJson')).toHaveAttribute('aria-invalid', 'true'); expect(eventCalls(parity)).toHaveLength(1);
      await field(parity, 'messageJson').fill('{"foo":1}'); await button(parity, 'publish').click();
      await expect(parity.page.getByText(copy(parity).published.replace('{topic}', 'synthetic-orders'), { exact: true }).first()).toBeAttached();
      await button(parity, 'consume').click(); await expect(surface(parity).getByRole('tree').first()).toBeVisible();
      await field(parity, 'newTopic').fill(' synthetic-new '); await button(parity, 'create').click();
      await expect(radio(parity, 'synthetic-new')).toBeChecked(); await expect(parity.page.getByText(copy(parity).created.replace('{topic}', 'synthetic-new'), { exact: true }).first()).toBeAttached();
      expect(eventCalls(parity)).toEqual([{ method: 'GET', path: topicsPath, body: undefined }, { method: 'POST', path: publishPath, body: { foo: 1 } }, { method: 'GET', path: messagesQuery, body: undefined }, { method: 'POST', path: topicsPath, body: { name: 'synthetic-new' } }, { method: 'GET', path: topicsPath, body: undefined }]);
    });
    test('error-empty', { tag: '@legacy-parity' }, async ({ parity }) => {
      await parity.open(manifest.route, { workspaces: 'empty' }); await expect(surface(parity).getByRole('heading', { name: copy(parity).workspaceRequired, exact: true })).toBeVisible(); expect(eventCalls(parity)).toHaveLength(0);
      await parity.open(manifest.route, { 'events-topics': 'empty' }); await expect(surface(parity).getByText(copy(parity).empty, { exact: true })).toBeVisible();
      await parity.open(manifest.route, { 'events-messages': ['empty', 'timeout'] }); await ready(parity);
      await expect(surface(parity).getByText(copy(parity).beforePoll, { exact: true })).toBeVisible(); await radio(parity).check(); await button(parity, 'consume').click(); await expect(surface(parity).getByText(copy(parity).noMessages, { exact: true })).toBeVisible();
      await button(parity, 'consume').click(); await expect(surface(parity).getByText(copy(parity).timeout, { exact: true })).toBeVisible(); await expect(surface(parity).getByText(copy(parity).noMessages, { exact: true })).toHaveCount(0);
    });
    test('accessibility', async ({ parity }) => {
      await parity.open(manifest.route); await ready(parity); await check.assertAccessibility(parity);
      await radio(parity).focus(); await parity.page.keyboard.press('Space'); await expect(radio(parity)).toBeChecked();
      await button(parity, 'publish').focus(); await parity.page.keyboard.press('Enter'); await expect(surface(parity).locator('#events-publish-button')).toBeEnabled();
      await button(parity, 'consume').focus(); await parity.page.keyboard.press('Enter'); await expect(surface(parity).getByRole('tree').first()).toBeVisible();
      await check.assertAccessibility(parity); await assertEventsLocale(parity);
    });
    test('runtime-health', async ({ parity }) => {
      await parity.open('/console/overview');
      if (width < 1024) await parity.page.getByRole('button', { name: locale === 'es' ? 'Abrir navegación' : 'Open navigation', exact: true }).click();
      const link = parity.page.locator('a[href$="/console/events/data"]').first(); let documents = 0;
      parity.page.on('request', (request) => { if (request.isNavigationRequest() && request.frame() === parity.page.mainFrame()) documents++; });
      await link.click(); await ready(parity); expect(documents).toBe(0); await check.assertRuntimeHealth(parity);
      await parity.open(manifest.route); await ready(parity); await check.assertRuntimeHealth(parity);
      await parity.open(manifest.route, { 'events-topics': ['401', 'success-three'] }); await ready(parity);
      expect(parity.network.requests.filter(({ path }) => path.endsWith('/refresh'))).toHaveLength(1);
      await parity.open(manifest.route, { 'events-topics': '401', refresh: '401' });
      await expect(parity.page.getByRole('heading', { name: locale === 'es' ? 'Accede a In Falcone Console' : 'Sign in to In Falcone Console', exact: true })).toBeVisible();
    });
    test('responsive', async ({ parity }) => {
      await parity.open(manifest.route); await ready(parity); await check.assertResponsive(parity, width); await radio(parity).check(); await button(parity, 'consume').click(); await expect(surface(parity).getByRole('tree').first()).toBeVisible(); await check.assertResponsive(parity, width);
    });
    test('kit-conformance', async ({ parity }) => {
      await check.kitConformance(manifest); await parity.open(manifest.route); await ready(parity); await expect(surface(parity).getByRole('searchbox')).toHaveCount(0); await assertEventsLocale(parity);
    });
    test('visual-review', async ({ parity }, info) => {
      const cases = [
        ['admin', {}, null], ['polled-messages', {}, 'consume'], ['no-topics', { 'events-topics': 'empty' }, null],
        ['no-access', { 'events-topics': '403' }, null], ['topic-not-found', { 'events-messages': '404' }, 'consume'], ['error', { 'events-topics': '500' }, null],
      ];
      for (const [name, variants, op] of cases) {
        await parity.open(manifest.route, variants);
        if (op) { await ready(parity); await radio(parity).check(); await button(parity, op).click(); if (name === 'topic-not-found') await expect(button(parity, 'back')).toBeVisible(); else await expect(surface(parity).getByRole('tree').first()).toBeVisible(); }
        else if (name === 'admin') await ready(parity);
        else await expect(surface(parity).getByRole('heading', { name: copy(parity)[name === 'no-topics' ? 'empty' : name === 'no-access' ? 'noAccess' : 'listError'], exact: true })).toBeVisible();
        if (name === 'topic-not-found') await expect(surface(parity).getByRole('heading', { name: copy(parity).notFound, exact: true })).toBeVisible();
        if (name === 'polled-messages') await expect(surface(parity).getByRole('tree').first()).toBeVisible();
        await assertEventsLocale(parity); await check.assertAccessibility(parity); await screenshot(parity, info, name);
      }
      await parity.page.addInitScript(seedHistoryPrincipal, { platformRoles: ['workspace_viewer'] });
      await parity.open(manifest.route); await ready(parity); await expect(field(parity, 'messageJson')).toHaveCount(0); await expect(surface(parity).getByText(copy(parity).readNote, { exact: true })).toBeVisible();
      await assertEventsLocale(parity); await check.assertAccessibility(parity); await screenshot(parity, info, 'read-only');
    });
  });
  // Supplemental behavior cases are outside the eight-check report group.
  test.describe(`events supplemental ${locale} ${width}`, () => {
    test.use({ role: 'superadmin', locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test.beforeEach(async ({ parity }) => trackInjectedErrors(parity));
    test('migration errors and recovery', { tag: '@migration-behavior' }, async ({ parity }) => {
      for (const variant of ['403', '500', 'network']) {
        await parity.open(manifest.route, { 'events-topics': [variant, 'success-three'] });
        await expect(surface(parity).getByRole('heading', { name: copy(parity)[variant === '403' ? 'noAccess' : variant === '500' ? 'listError' : 'networkError'], exact: true })).toBeVisible();
        if (variant === '403') { await expect(button(parity, 'retry')).toHaveCount(0); await expect(surface(parity).getByText('synthetic-error', { exact: true })).toBeVisible(); }
        else { const before = eventCalls(parity).length; await button(parity, 'retry').click(); await ready(parity); expect(eventCalls(parity).length).toBe(before + 1); }
      }
      for (const op of ['publish', 'consume']) {
        await parity.open(manifest.route, { [op === 'publish' ? 'events-publish' : 'events-messages']: '404' }); await ready(parity); await radio(parity).check(); await button(parity, op).click();
        await expect(surface(parity).getByRole('heading', { name: copy(parity).notFound, exact: true })).toBeVisible(); await button(parity, 'back').click(); await ready(parity);
        await expect(surface(parity).getByRole('table')).toBeFocused(); await expect(surface(parity).getByRole('radio', { checked: true })).toHaveCount(0);
      }
      await parity.open(manifest.route, { 'events-publish': '403' }); await ready(parity); await radio(parity).check(); await field(parity, 'messageJson').fill('{"keep":true}'); await button(parity, 'publish').click();
      await expect(surface(parity).getByText(copy(parity).errorTitle, { exact: true })).toBeVisible(); await expect(field(parity, 'messageJson')).toHaveValue('{"keep":true}');
      await parity.open(manifest.route, { 'events-messages': ['success-two', 'network'] }); await ready(parity); await radio(parity).check(); await button(parity, 'consume').click(); await expect(surface(parity).getByRole('tree').first()).toBeVisible();
      await button(parity, 'consume').click(); await expect(surface(parity).getByRole('heading', { name: copy(parity).networkError, exact: true })).toBeVisible(); await expect(surface(parity).getByRole('tree')).toHaveCount(0);
    });
    test('busy selection targets the original topic', { tag: '@legacy-parity' }, async ({ parity }) => {
      for (const op of ['publish', 'consume']) {
        await parity.open(manifest.route, { [op === 'publish' ? 'events-publish' : 'events-messages']: { variant: 'success', delayMs: 1000 } }); await ready(parity); await radio(parity).check(); await button(parity, op).click();
        await radio(parity, 'synthetic-audit').check(); await expect(surface(parity).getByText(copy(parity).selected.replace('{topic}', 'synthetic-audit'), { exact: true })).toBeVisible();
        await expect(field(parity, 'messageJson')).toBeDisabled(); await expect(field(parity, 'newTopic')).toBeDisabled();
        await expect(surface(parity).locator('#events-publish-button')).toBeDisabled(); await expect(surface(parity).locator('#events-consume-button')).toBeDisabled();
        await expect(surface(parity).locator('#events-consume-button')).toBeEnabled();
        expect(eventCalls(parity).at(-1).path).toBe(op === 'publish' ? publishPath : messagesQuery);
      }
    });
  });
}
