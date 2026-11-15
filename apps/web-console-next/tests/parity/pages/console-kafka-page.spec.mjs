import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import manifest, { fixtures, paths, parityDifferences } from './console-kafka-page.manifest.ts';
import { installKafkaHarness } from './console-kafka-page.support.mjs';
import { assertKafkaLocale } from './console-kafka-page.locale.mjs';

const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-kafka-page.json`, import.meta.url), 'utf8'))]));
const copy = (p) => bundles[p.locale];
const surface = (p) => p.page.getByTestId('console-kafka-page');
const toggle = (p, active = false) => surface(p).getByRole('button', { name: copy(p)[active ? 'stopStream' : 'startStream'], exact: true });
async function ready(p) { await expect(surface(p).getByRole('button', { name: 'orders.created', exact: true })).toBeVisible(); }
async function select(p) {
  await ready(p); await surface(p).getByRole('button', { name: 'orders.created', exact: true }).click();
  await expect(surface(p).getByRole('heading', { name: 'orders.created', exact: true })).toBeVisible();
}
async function tab(p, key) { await surface(p).getByRole('tab', { name: copy(p).tabs[key], exact: true }).click(); }
async function capture(p, info, name, target = surface(p)) {
  await target.scrollIntoViewIfNeeded(); await expect(target).toBeInViewport(); await assertKafkaLocale(p); await p.page.evaluate(() => document.fonts.ready);
  const body = await p.page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
  await info.attach(`${name}-${p.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}
const onlyKafka = (h) => h.calls.filter(({ path }) => path.startsWith('/v1/events/'));
const requestIds = { bridge: 'couldNotLoadTheBridgeList', detail: 'couldNotLoadTheTopicDetail', access: 'couldNotLoadTheTopicAccessPolicy', metadata: 'couldNotLoadTheTopicOperationalMetadata' };

for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) test.describe(`console-kafka-page | superadmin | ${locale} | ${width}`, () => {
  test.use({ role: 'superadmin', locale, viewport: { width, height: 900 }, pageEndpoints: {} });
  let h;
  test.beforeEach(async ({ parity }) => { h = await installKafkaHarness(parity); });
  test.afterEach(async ({ parity }) => { expect(h.unmatched).toEqual([]); await check.assertRuntimeHealth(parity); });

  test('data', async ({ parity: p }) => {
    await h.open('kafka:legacy-service-nominal');
    const legacyTopic = surface(p).getByRole('button', { name: 'platform.audit.events', exact: true }); await expect(legacyTopic).toBeVisible(); await legacyTopic.click(); await expect(surface(p).getByRole('heading', { name: 'platform.audit.events', exact: true })).toBeVisible();
    expect(onlyKafka(h).map(({ path }) => new URL(path, 'http://local').pathname).sort()).toEqual(['/v1/events/workspaces/ws_alpha_prod/inventory', '/v1/events/topics/topic_audit_001', '/v1/events/topics/topic_audit_001/access', '/v1/events/topics/topic_audit_001/metadata'].sort());
    await h.open(); await select(p); const c = copy(p);
    const kpis = surface(p).locator('dl').filter({ has: p.page.getByText(c.total, { exact: true }) });
    for (const value of [c.total, c.active, c.provisioning, c.degraded]) await expect(kpis).toContainText(value);
    expect(await kpis.locator('dd').allTextContents()).toEqual(['3', '1', '1', '1']);
    const inventory = surface(p).getByRole('table', { name: c.kafkaTopics, exact: true }); await expect(inventory.getByRole('row')).toHaveCount(4);
    for (const item of fixtures['kafka:inventory-3-with-bridges'].items) { await expect(inventory.getByRole('button', { name: item.topicName, exact: true })).toBeVisible(); await expect(inventory.getByText(item.physicalTopicName, { exact: true }).first()).toBeVisible(); }
    const bridge = surface(p).getByRole('table', { name: c.bridges, exact: true }); for (const value of ['orders_outbox', 'res_topic_1', c.atLeastOnce]) await expect(bridge).toContainText(value);
    await expect(surface(p).getByText(c.noStatusHistory, { exact: true })).toBeVisible(); await expect(surface(p).getByRole('meter', { name: c.quotas })).toHaveAttribute('aria-valuenow', '100');
    for (const value of ['/events/orders', '4096', 'Gzip', 'S3', 'Cg.Ten Alpha.']) await expect(surface(p).getByText(value, { exact: true })).toBeVisible();
    await tab(p, 'access'); await expect(surface(p).getByText('svc-orders', { exact: true })).toBeVisible(); await expect(surface(p).getByText('svc-denied', { exact: true })).toBeVisible();
    await tab(p, 'metadata'); await expect(surface(p).getByText('Cg-Orders', { exact: true })).toBeVisible(); await expect(surface(p).getByText(/Metadata parcial/)).toBeVisible();
    expect(['inventory', 'bridge', 'detail', 'access', 'metadata'].map((key) => h.count(key))).toEqual([1, 1, 1, 1, 1]);
    await h.open('kafka:topic-metadata-legacy-fields'); await select(p); await tab(p, 'metadata');
    for (const value of ['48', '1234', c.providerManaged]) await expect(surface(p).getByText(value, { exact: true })).toBeVisible(); await expect(surface(p).getByText('44', { exact: true })).toHaveCount(2);
    await h.open('kafka:inventory-120'); await expect(surface(p).getByRole('table', { name: c.kafkaTopics, exact: true }).getByRole('row')).toHaveCount(121); await expect(surface(p).locator('dl').first()).toContainText('120');
    await expect(surface(p).getByRole('button', { name: /Next page|Siguiente página/ })).toHaveCount(0); await assertKafkaLocale(p);
  });

  test('action', async ({ parity: p }) => {
    await h.open(); await select(p); await tab(p, 'publish'); const c = copy(p);
    await surface(p).getByLabel(c.jsonPayload, { exact: true }).fill('{"a":1}'); await surface(p).getByLabel(c.eventType, { exact: true }).fill('com.example.event');
    const publish = surface(p).getByRole('button', { name: c.publishEvent, exact: true }); await publish.click(); await expect(surface(p).getByText('pub_123', { exact: true })).toBeVisible(); await expect(publish).toBeFocused();
    expect(h.calls.find(({ method }) => method === 'POST')).toMatchObject({ method: 'POST', path: paths.publish, body: { payload: { a: 1 }, eventType: 'com.example.event', contentType: 'application/json' } });
    await tab(p, 'stream'); await toggle(p).click(); await expect(toggle(p, true)).toBeFocused(); await expect(surface(p).getByRole('log')).toContainText('key-4');
    const messages = await surface(p).getByRole('log').innerText(); expect(messages.indexOf('key-4')).toBeLessThan(messages.indexOf('key-0'));
    expect(h.calls.find(({ path }) => path === paths.stream).authorization).toMatch(/^Bearer /);
    await toggle(p, true).click(); await expect(toggle(p)).toBeFocused(); expect(await p.page.evaluate(() => window.__kafkaOpenStreams)).toBe(0);
    await h.open('kafka:stream-burst-20'); await select(p); await tab(p, 'stream'); await toggle(p).click(); await expect(surface(p).getByText(c.highEventVolumeTheDisplayMayLagBehindTheBroker)).toBeVisible(); await expect(surface(p).getByRole('log')).toContainText('key-19');
    await toggle(p, true).click(); await assertKafkaLocale(p);
  });

  test('error-empty', async ({ parity: p }) => {
    test.setTimeout(180000); const c = copy(p);
    await h.open('kafka:legacy-service-empty'); await expect(surface(p).getByText(c.thereAreNoTopicsInThisWorkspace)).toBeVisible();
    await h.open('kafka:legacy-service-error'); await expect(surface(p).getByRole('heading', { name: c.couldNotLoadTheKafkaInventory })).toBeVisible(); await expect(surface(p).getByRole('button', { name: c.retry })).toBeVisible();
    for (const name of ['kafka:inventory-empty', 'kafka:inventory-counts-no-bridge-ids', 'shell:tenant-none', 'shell:workspace-none']) {
      await h.open(name);
      const key = name === 'kafka:inventory-empty' ? 'thereAreNoTopicsInThisWorkspace' : name === 'kafka:inventory-counts-no-bridge-ids' ? 'theBridgeListRequiresIdsExposedByTheInventory' : name === 'shell:tenant-none' ? 'selectAnOrganizationToContinue' : 'selectAWorkspace';
      await expect(surface(p).getByText(c[key], { exact: true })).toBeVisible(); if (name.startsWith('shell:')) expect(onlyKafka(h)).toHaveLength(0); await assertKafkaLocale(p);
    }
    for (const name of ['kafka:inventory-403', 'kafka:inventory-500', 'kafka:inventory-network', 'kafka:inventory-401', 'kafka:inventory-401-refresh-rejected', 'kafka:inventory-replay-401']) {
      await h.open(name);
      if (name.endsWith('refresh-rejected')) { await expect(p.page).toHaveURL(/\/login$/); expect(h.count('inventory')).toBe(1); expect(h.count('refresh')).toBe(1); continue; }
      if (name === 'kafka:inventory-401') { await ready(p); expect(h.count('inventory')).toBe(2); expect(h.count('refresh')).toBe(1); const reads = onlyKafka(h); expect(reads[1].authorization).not.toBe(reads[0].authorization); }
      else if (name === 'kafka:inventory-403') await expect(surface(p).getByText(c.youDoNotHaveAccessToTheKafkaInventory)).toBeVisible();
      else if (name.endsWith('replay-401')) { await expect(surface(p).getByText(c.errors.unauthorized)).toBeVisible(); expect(await p.page.evaluate(() => sessionStorage.getItem('in-falcone.console-shell-session'))).not.toBeNull(); }
      else { await expect(surface(p).getByRole('heading', { name: c.couldNotLoadTheKafkaInventory })).toBeVisible(); h.state.errors.inventory = null; await surface(p).getByRole('button', { name: c.retry, exact: true }).click(); await ready(p); expect(h.count('inventory')).toBe(2); }
      await assertKafkaLocale(p);
    }
    for (const section of ['bridge', 'detail', 'access', 'metadata']) {
      await h.open(`kafka:${section === 'bridge' ? 'bridge' : `topic-${section}`}-500`, { recover: [section] }); await select(p); if (section !== 'bridge') await tab(p, section);
      await expect(surface(p).getByRole('heading', { name: c[requestIds[section]], exact: true })).toBeVisible(); await expect(surface(p).getByText('kafka-browser-request')).toBeVisible();
      const before = h.calls.length; const release = h.hold(section); const retry = surface(p).getByRole('button', { name: c.retry, exact: true }); await retry.click(); await expect(surface(p).getByRole('button', { name: c.retrying, exact: true })).toBeFocused(); release();
      await expect(surface(p).getByRole('heading', { name: c[requestIds[section]], exact: true })).toHaveCount(0); expect(h.calls).toHaveLength(before + 1); expect(h.count(section)).toBe(2);
      await tab(p, 'detail'); await expect(surface(p).getByText('/events/orders', { exact: true })).toBeVisible(); await check.assertAccessibility(p);
    }
    for (const section of ['access', 'metadata']) {
      await h.open(`kafka:topic-${section}-403`); await select(p); await tab(p, section);
      await expect(surface(p).getByText(c[section === 'access' ? 'youDoNotHaveAccessToTheTopicAccessPolicy' : 'youDoNotHaveAccessToTheTopicOperationalMetadata'])).toBeVisible(); await tab(p, 'detail'); await expect(surface(p).getByText('/events/orders', { exact: true })).toBeVisible();
    }
    await h.open('kafka:topic-404'); await select(p); await expect(surface(p).getByText(c.theTopicIsNoLongerAvailable)).toBeVisible(); await surface(p).getByRole('button', { name: c.backToInventory }).click(); await expect(surface(p).getByText(c.selectATopicFromTheInventoryToReviewDetailAccessMetadataPublishEventsOrOpenAnSseStream)).toBeVisible();
    await h.open('kafka:publish-429'); await select(p); await tab(p, 'publish'); const publish = surface(p).getByRole('button', { name: c.publishEvent }); await publish.click(); await expect(surface(p).getByText(c.checkDetailQuotasToVerifyLimitsOrLimitEnforcement)).toBeVisible(); await expect(publish).toBeFocused();
    for (const status of [401, 503]) { await h.open(`kafka:stream-${status}`); await select(p); await tab(p, 'stream'); await toggle(p).click(); await expect(surface(p).getByText(c.errors[status === 401 ? 'unauthorized' : 'server'])).toBeVisible(); await expect(toggle(p)).toBeFocused(); expect(h.count('refresh')).toBe(0); }
    await h.open('kafka:stream-no-session'); await select(p); await tab(p, 'stream'); await p.page.evaluate(() => sessionStorage.removeItem('in-falcone.console-shell-session')); await toggle(p).click(); await expect(surface(p).getByText(c.sessionUnavailableSignInAgain)).toBeVisible(); expect(h.count('stream')).toBe(0);
    await h.open('kafka:stream-dropped'); await select(p); await tab(p, 'stream'); await toggle(p).click(); await expect(toggle(p, true)).toBeVisible(); await p.page.evaluate(() => window.__kafkaDrop()); await expect(surface(p).getByText(c.theStreamConnectionFailed)).toBeVisible(); await expect(toggle(p)).toBeFocused(); await toggle(p).click(); await expect(toggle(p, true)).toBeVisible(); expect(h.count('stream')).toBe(2); await toggle(p, true).click();
    await assertKafkaLocale(p);
  });

  test('accessibility', async ({ parity: p }) => {
    await h.open(); await ready(p); const row = surface(p).getByRole('button', { name: 'orders.created', exact: true }); await row.focus(); await p.page.keyboard.press('Enter');
    await expect(surface(p).getByRole('heading', { name: 'orders.created', exact: true })).toBeVisible(); await check.assertAccessibility(p);
    const detail = surface(p).getByRole('tab', { name: copy(p).tabs.detail }); await detail.focus(); await p.page.keyboard.press('ArrowRight'); await expect(surface(p).getByRole('tab', { name: copy(p).tabs.access })).toBeFocused();
    for (const key of ['access', 'metadata', 'publish', 'stream']) { await tab(p, key); await check.assertAccessibility(p); }
    await toggle(p).click(); await expect(surface(p).getByRole('log')).toHaveAttribute('aria-live', 'off'); await toggle(p, true).click(); await expect(toggle(p)).toBeFocused(); await assertKafkaLocale(p);
  });

  test('kit-conformance', async ({ parity: p }) => {
    await h.open(); await select(p); await check.kitConformance(manifest);
    await expect(surface(p).getByText(copy(p).noStatusHistory)).toBeVisible(); await expect(surface(p).locator('svg[aria-label*="trend"], [data-kpi-delta]')).toHaveCount(0); await assertKafkaLocale(p);
  });

  test('runtime-health', async ({ parity: p }) => {
    await h.open(); await select(p); await tab(p, 'stream'); await toggle(p).click(); await expect.poll(() => p.page.evaluate(() => window.__kafkaOpenStreams)).toBe(1);
    await p.page.evaluate(() => window.__kafkaDrop()); await expect(toggle(p)).toBeVisible(); await toggle(p).click(); await expect.poll(() => p.page.evaluate(() => window.__kafkaOpenStreams)).toBe(1);
    // A topic change and same-document browser navigation both unmount the stream owner.
    await surface(p).getByRole('button', { name: 'orders.pending', exact: true }).click(); await expect.poll(() => p.page.evaluate(() => window.__kafkaOpenStreams)).toBe(0);
    await select(p); await tab(p, 'stream'); await toggle(p).click(); await expect.poll(() => p.page.evaluate(() => window.__kafkaOpenStreams)).toBe(1);
    await p.page.evaluate(() => { const url = new URL(location.href); url.pathname = url.pathname.replace(/\/kafka$/, '/kafka-unavailable'); history.pushState({}, '', url); dispatchEvent(new PopStateEvent('popstate')); });
    await expect(surface(p)).toHaveCount(0); await expect.poll(() => p.page.evaluate(() => window.__kafkaOpenStreams)).toBe(0);
    await check.assertRuntimeHealth(p);
  });

  test('responsive', async ({ parity: p }) => {
    await h.open('kafka:topic-metadata-legacy-fields'); await select(p); for (const key of ['detail', 'access', 'metadata', 'publish', 'stream']) { await tab(p, key); await check.assertResponsive(p, width); }
  });

  test('visual-review', async ({ parity: p }, info) => {
    await info.attach('allowed-parity-differences', { body: JSON.stringify(parityDifferences), contentType: 'application/json' });
    await h.open(); await select(p); await capture(p, info, 'inventory-kpis-selected-detail');
    for (const key of ['detail', 'access', 'metadata', 'publish', 'stream']) { await tab(p, key); await capture(p, info, `selected-${key}`, surface(p).getByRole('tabpanel')); }
    await toggle(p).click(); await expect(surface(p).getByRole('log')).toContainText('key-4'); await capture(p, info, 'frozen-stream-events', surface(p).getByRole('log')); await toggle(p, true).click();
    for (const status of [500, 403]) { await h.open(`kafka:topic-metadata-${status}`); await select(p); await tab(p, 'metadata'); await expect(surface(p).getByText(copy(p)[status === 500 ? 'couldNotLoadTheTopicOperationalMetadata' : 'youDoNotHaveAccessToTheTopicOperationalMetadata'], { exact: true }).first()).toBeVisible(); await capture(p, info, `metadata-${status}`, surface(p).getByRole('tabpanel')); }
    await h.open('kafka:inventory-500'); await expect(surface(p).getByRole('heading', { name: copy(p).couldNotLoadTheKafkaInventory })).toBeVisible(); await capture(p, info, 'inventory-error');
  });
});
