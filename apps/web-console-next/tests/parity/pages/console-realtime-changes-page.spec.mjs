import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { apiKey, mongoPath, pgPath, streamFixtures, allowedDifferences } from './console-realtime-changes-page.manifest.ts';
import { streamMock } from './console-realtime-changes-page.stream.mjs';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';

const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale,
  JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-realtime-changes-page.json`, import.meta.url), 'utf8')),
]));
const copy = (p) => bundles[p.locale];
const surface = (p) => p.page.getByTestId('console-realtime-changes-page');
const rows = (p) => p.page.locator('[data-slot="log-line"]');
const tree = (p) => surface(p).getByRole('tree', { name: copy(p).jsonLabel });
const heading = (p, key) => surface(p).getByRole('heading', { name: copy(p)[key], exact: true });
const streamCalls = (p) => p.page.evaluate(() => window.__streamCalls);
const streamUrls = async (p) => (await streamCalls(p)).map((call) => call.url);
async function open(p, fixture = 'realtime-sse-mongo', shell = {}) {
  await p.page.addInitScript(streamMock, streamFixtures[fixture] ?? []);
  await p.open(manifest.route, shell);
}
async function chooseSource(p, key) {
  await surface(p).getByRole('combobox', { name: copy(p).source, exact: true }).click();
  await p.page.getByRole('option', { name: copy(p)[key], exact: true }).click();
}
async function fill(p, source = 'mongo') {
  const c = copy(p), form = surface(p);
  await form.getByLabel(c.database, { exact: true }).fill(' app_db ');
  if (source === 'mongo') await form.getByLabel(c.collection, { exact: true }).fill('orders');
  else {
    await chooseSource(p, 'sourcePostgres');
    await form.getByLabel(c.table, { exact: true }).fill('accounts');
  }
  await form.getByLabel(c.anonKey, { exact: true }).fill(apiKey);
}
const subscribe = (p) => surface(p).getByRole('button', { name: copy(p).subscribe, exact: true }).click();
const stop = (p) => surface(p).getByRole('button', { name: copy(p).stop, exact: true }).click();
const retry = (p) => surface(p).getByRole('button', { name: copy(p).retry, exact: true });
async function start(p, fixture, source = 'mongo') { await open(p, fixture); await fill(p, source); await subscribe(p); }
async function snapshot(p, info, name) {
  await check.assertLocale(p);
  const body = await p.page.screenshot({ fullPage: true, animations: 'disabled' });
  await info.attach(`${name}-${p.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}

for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-realtime-changes-page | superadmin | ${locale} | ${width}`, () => {
    test.use({ locale, role: 'superadmin', viewport: { width, height: 900 } });
    test('data', async ({ parity: p }) => {
      const c = copy(p);
      await start(p, 'realtime-sse-mongo');
      await expect(rows(p)).toHaveCount(3);
      await expect(rows(p).nth(0)).toContainText('replace');
      await expect(rows(p).nth(0)).toContainText('{"_id":"o3","total":30}');
      await expect(rows(p).nth(1)).toContainText('update');
      await expect(rows(p).nth(2)).toContainText('insert');
      await expect(surface(p).getByText('(3)', { exact: true })).toBeVisible();
      await expect(tree(p)).toContainText('o3');
      await expect(surface(p).getByRole('log', { name: c.logTitle })).toBeVisible();
      await rows(p).nth(2).getByRole('button', { name: /^(Inspeccionar|Inspect)/ }).click();
      await expect(tree(p)).toContainText('o1');
      await expect(tree(p)).not.toContainText('o3');
      await expect(rows(p)).toHaveCount(3);
      await p.page.evaluate(() => window.__stream.releaseHeld(0));
      await expect(surface(p).getByText('(4)', { exact: true })).toBeVisible();
      await expect(rows(p).nth(0)).toContainText('delete');
      await expect(tree(p)).toContainText('o1');
      expect(await streamUrls(p)).toEqual([mongoPath]);
      await start(p, 'realtime-sse-pg', 'postgres');
      await expect(rows(p)).toHaveCount(3);
      await expect(rows(p).nth(2)).toContainText('insert');
      await expect(rows(p).nth(1)).toContainText('update');
      await expect(rows(p).nth(0)).toContainText('delete');
      expect(await streamUrls(p)).toEqual([pgPath]);
      await start(p, 'realtime-sse-101-events');
      await expect(surface(p).getByText('(100)', { exact: true })).toBeVisible();
      await start(p, 'realtime-sse-malformed');
      await expect(rows(p)).toHaveCount(2);
      await expect(rows(p).nth(0)).toContainText('"_id":"b"');
      await expect(rows(p).nth(1)).toContainText('"_id":"a"');
      await expect(tree(p)).toContainText('b');
      await check.assertRuntimeHealth(p);
      await check.assertLocale(p);
      expect(allowedDifferences).toHaveLength(7);
    });
    test('action', async ({ parity: p }) => {
      const c = copy(p);
      await open(p, 'realtime-sse-mongo');
      expect(await streamCalls(p)).toEqual([]);
      await fill(p); await subscribe(p);
      await expect(surface(p).getByText(c.statusLive, { exact: true })).toBeVisible();
      let calls = await streamCalls(p);
      expect(calls).toHaveLength(1);
      // The stream carries only the Accept header: the anon key in the URL is the sole credential.
      expect(calls[0]).toMatchObject({ url: mongoPath, method: 'GET', headers: ['Accept'] });
      expect(calls[0].headers.map((name) => name.toLowerCase())).not.toContain('authorization');
      await stop(p);
      await expect(surface(p).getByRole('button', { name: c.subscribe, exact: true })).toBeVisible();
      expect((await streamCalls(p))[0].aborted).toBe(true);
      // Subscribing again opens exactly one new stream with a fresh list.
      await subscribe(p);
      await expect(rows(p)).toHaveCount(3);
      calls = await streamCalls(p);
      expect(calls).toHaveLength(2);
      expect(calls[0].aborted).toBe(true);
      await open(p, 'realtime-sse-500'); await fill(p); await subscribe(p);
      await expect(heading(p, 'errorTitle')).toBeVisible();
      await retry(p).click();
      await expect(surface(p).getByText(c.statusLive, { exact: true })).toBeVisible();
      expect(await streamUrls(p)).toEqual([mongoPath, mongoPath]);
      await open(p, 'realtime-sse-drop'); await fill(p); await subscribe(p);
      await expect(heading(p, 'droppedTitle')).toBeVisible();
      await expect(rows(p).first()).toContainText(c.stale);
      expect(await streamUrls(p)).toEqual([mongoPath]);
      await open(p, 'realtime-sse-drop-retry'); await fill(p); await subscribe(p);
      await expect(heading(p, 'droppedTitle')).toBeVisible();
      await retry(p).click();
      await expect(rows(p)).toHaveCount(2);
      await expect(heading(p, 'droppedTitle')).toHaveCount(0);
      await p.page.waitForTimeout(500);
      calls = await streamCalls(p);
      expect(calls).toHaveLength(2);
      expect(calls[0].aborted).toBe(true);
      await open(p, 'realtime-sse-401'); await fill(p); await subscribe(p);
      await surface(p).getByRole('button', { name: c.noAccessAction, exact: true }).click();
      await expect(surface(p).getByLabel(c.anonKey, { exact: true })).toBeFocused();
      await open(p, 'realtime-sse-404'); await fill(p); await subscribe(p);
      await expect(surface(p).getByRole('link', { name: c.notFoundMongo, exact: true })).toHaveAttribute('href', '/console/mongo');
      await expect(surface(p).getByRole('link', { name: c.notFoundPostgres, exact: true })).toHaveAttribute('href', '/console/postgres');
      expect(p.network.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/refresh'))).toHaveLength(0);
    });
    test('error-empty', async ({ parity: p }) => {
      const c = copy(p);
      await open(p, 'realtime-sse-mongo', { workspaces: 'empty' });
      await expect(heading(p, 'workspaceRequired')).toBeVisible();
      expect(await streamCalls(p)).toEqual([]);
      await open(p);
      await expect(heading(p, 'firstRunTitle')).toBeVisible();
      await surface(p).getByLabel(c.anonKey, { exact: true }).fill(apiKey);
      await subscribe(p);
      await expect(surface(p).getByText(c.validationMongo, { exact: true })).toBeVisible();
      expect(await streamCalls(p)).toEqual([]);
      await chooseSource(p, 'sourcePostgres'); await subscribe(p);
      await expect(surface(p).getByText(c.validationPostgres, { exact: true })).toBeVisible();
      await start(p, 'realtime-sse-delayed');
      await expect(surface(p).getByText(c.statusConnecting, { exact: true })).toBeVisible();
      await expect(surface(p).getByText(c.connecting)).toBeAttached();
      await p.page.evaluate(() => window.__stream.release(0));
      await expect(surface(p).getByText(c.statusLive, { exact: true })).toBeVisible();
      await expect(surface(p).getByText(c.connecting)).toHaveCount(0);
      await start(p, 'realtime-sse-idle');
      await expect(surface(p).getByText(c.listeningMongo, { exact: true })).toBeVisible();
      await expect(surface(p).getByText(c.statusLive, { exact: true })).toBeVisible();
      await p.page.evaluate(() => window.__stream.releaseHeld(0));
      await expect(rows(p)).toHaveCount(1);
      await expect(surface(p).getByText(c.listeningMongo, { exact: true })).toHaveCount(0);
      for (const [fixture, key] of [['realtime-sse-401', 'noAccessTitle'], ['realtime-sse-403', 'noAccessTitle'], ['realtime-sse-404', 'notFoundTitle'], ['realtime-sse-500', 'errorTitle']]) {
        await start(p, fixture);
        await expect(surface(p).getByText(c.streamError, { exact: true })).toBeVisible();
        await expect(heading(p, key)).toBeVisible();
      }
      await expect(surface(p).getByText('synthetic-request-id', { exact: true })).toBeVisible();
      await start(p, 'realtime-sse-500-no-id');
      await expect(surface(p).getByText(new RegExp(c.noRequestId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeVisible();
      await start(p, 'realtime-sse-drop');
      await expect(heading(p, 'droppedTitle')).toBeVisible();
      await expect(surface(p).getByText(c.statusDisconnected, { exact: true })).toBeVisible();
      await expect(rows(p).first()).toContainText(c.stale);
      expect(p.network.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/refresh'))).toHaveLength(0);
    });
    test('accessibility', async ({ parity: p }) => {
      const c = copy(p);
      await open(p); await check.assertAccessibility(p); await check.assertLocale(p);
      for (const fixture of ['realtime-sse-mongo', 'realtime-sse-401', 'realtime-sse-404', 'realtime-sse-500', 'realtime-sse-drop']) {
        await start(p, fixture); await expect(surface(p).getByRole('button', { name: new RegExp(`${c.stop}|${c.subscribe}`) })).toBeVisible();
        await check.assertAccessibility(p); await check.assertLocale(p);
      }
      await start(p, 'realtime-sse-mongo');
      await expect(surface(p).getByRole('log', { name: c.logTitle })).toBeVisible();
      await start(p, 'realtime-sse-500');
      await expect(retry(p)).toBeFocused();
      await retry(p).press('Enter');
      await expect(surface(p).getByText(c.statusLive, { exact: true })).toBeVisible();
      await start(p, 'realtime-sse-401');
      await surface(p).getByRole('button', { name: c.noAccessAction, exact: true }).press('Enter');
      await expect(surface(p).getByLabel(c.anonKey, { exact: true })).toBeFocused();
      await start(p, 'realtime-sse-404');
      await expect(surface(p).getByLabel(c.database, { exact: true })).toBeFocused();
      await open(p);
      const toggle = surface(p).getByRole('button', { name: c.showKey, exact: true });
      await toggle.focus(); await p.page.keyboard.press('Enter');
      // The accessible name changes on reveal, so focus is asserted through the new name.
      const hide = surface(p).getByRole('button', { name: c.hideKey, exact: true });
      await expect(hide).toBeFocused();
      await expect(hide).toHaveAttribute('aria-pressed', 'true');
    });
    test('runtime-health', async ({ parity: p, server }) => {
      const c = copy(p);
      await start(p, 'realtime-sse-mongo'); await expect(rows(p)).toHaveCount(3); await check.assertRuntimeHealth(p);
      await start(p, 'realtime-sse-malformed'); await expect(rows(p)).toHaveCount(2); await check.assertRuntimeHealth(p);
      await start(p, 'realtime-sse-drop-retry'); await retry(p).click(); await expect(rows(p)).toHaveCount(2); await check.assertRuntimeHealth(p);
      await start(p, 'realtime-sse-404');
      await p.page.route((url) => ['/console/mongo', '/console/postgres'].includes(url.pathname), (route) => route.fulfill({ contentType: 'text/html', body: `<html lang="${locale}"><body><main><h1>${c.notFoundMongo}</h1></main></body></html>` }));
      await surface(p).getByRole('link', { name: c.notFoundMongo, exact: true }).click();
      await expect(p.page).toHaveURL(new URL('/console/mongo', server.origin).href);
      await check.assertRuntimeHealth(p);
    });
    test('responsive', async ({ parity: p }) => {
      await start(p, 'realtime-sse-pg', 'postgres');
      await expect(rows(p)).toHaveCount(3);
      await check.assertResponsive(p, width);
      await expect(tree(p)).toBeVisible();
    });
    test('visual-review', async ({ parity: p }, info) => {
      await open(p); await snapshot(p, info, 'first-run');
      await chooseSource(p, 'sourcePostgres'); await snapshot(p, info, 'postgres-form');
      for (const fixture of ['realtime-sse-mongo', 'realtime-sse-pg', 'realtime-sse-idle', 'realtime-sse-403', 'realtime-sse-404', 'realtime-sse-500', 'realtime-sse-drop']) {
        await start(p, fixture, fixture === 'realtime-sse-pg' ? 'postgres' : 'mongo');
        await expect(surface(p).getByRole('button', { name: new RegExp(`${copy(p).stop}|${copy(p).subscribe}`) })).toBeVisible();
        if (fixture === 'realtime-sse-mongo') {
          await expect(rows(p)).toHaveCount(3); await snapshot(p, info, `${fixture}-newest`);
          await rows(p).nth(2).getByRole('button', { name: /^(Inspeccionar|Inspect)/ }).click(); await snapshot(p, info, `${fixture}-selected`);
        } else await snapshot(p, info, fixture);
      }
      await start(p, 'realtime-sse-delayed'); await snapshot(p, info, 'realtime-sse-delayed');
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
  });
}

// Burst announcement journey, kept outside the eight-check parity groups (the reporter requires exactly those checks).
for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-realtime-changes-page burst - ${locale} - ${width}`, () => {
    test.use({ locale, role: 'superadmin', viewport: { width, height: 900 } });
    test('burst announcement is bounded', async ({ parity: p }) => {
      // Record every distinct text of the polite live regions, so the announcement count is observable.
      await p.page.addInitScript(() => {
        window.__announcements = [];
        const read = () => Array.from(document.querySelectorAll('[aria-live="polite"]')).map((node) => node.textContent ?? '').join('|');
        let last = '';
        new MutationObserver(() => { const text = read(); if (text !== last) { last = text; if (text) window.__announcements.push(text); } })
          .observe(document, { subtree: true, childList: true, characterData: true });
      });
      await start(p, 'realtime-sse-burst');
      // The log viewer virtualizes its rows: assert the logical total and the newest, windowed line.
      await expect(rows(p).first()).toContainText('"_id":"b50"');
      await expect(surface(p).getByText('(50)', { exact: true })).toBeVisible();
      await expect.poll(() => p.page.evaluate(() => window.__announcements.filter((text) => /\b50\b/.test(text)).length)).toBe(1);
      // The burst is never announced line by line: wait past the announcement window and recount.
      await p.page.waitForTimeout(1000);
      const announcements = await p.page.evaluate(() => window.__announcements);
      expect(announcements.filter((text) => /\b50\b/.test(text))).toHaveLength(1);
      expect(announcements.filter((text) => /\b(?:[1-9]|[1-4]\d)\b (?:cambios?|new change)/.test(text))).toHaveLength(0);
      await check.assertRuntimeHealth(p);
    });
  });
}

// Session expiry while the page is active follows the shell: one refresh and one replay, or the login redirect.
// Not a parity group (no ' | ' in the title): the reporter would count its single check as an incomplete group.
const tenants = { items: [
  { tenantId: 'synthetic-tenant', displayName: 'Synthetic Tenant', slug: 'synthetic-tenant', state: 'active' },
  { tenantId: 't2', displayName: 'Second Tenant', slug: 't2', state: 'active' },
], page: { after: null } };
for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) for (const variant of ['session-401-refresh-ok', 'session-401-refresh-rejected']) {
  test.describe(`console-realtime-changes-page session - ${locale} - ${width} - ${variant}`, () => {
    test.use({ locale, role: 'superadmin', viewport: { width, height: 900 } });
    test('shared session refresh and replay are bounded', async ({ parity: p, server }) => {
      const t2Path = '/v1/workspaces?page%5Bsize%5D=100&sort=displayName&filter%5BtenantId%5D=t2';
      const t2 = [];
      await p.page.route((url) => url.pathname === '/v1/tenants', (route) => route.fulfill({ json: tenants }));
      // Fixtures match the full URL, query string included.
      await p.page.route((url) => url.pathname === '/v1/workspaces' && url.searchParams.get('filter[tenantId]') === 't2', async (route) => {
        const request = route.request();
        t2.push({ method: request.method(), url: new URL(request.url()).pathname + new URL(request.url()).search, authorization: request.headers().authorization, body: request.postData() });
        if (variant === 'session-401-refresh-ok' && t2.length > 1) {
          await route.fulfill({ json: { items: [{ workspaceId: 'synthetic-t2-workspace', tenantId: 't2', displayName: 'T2 workspace', slug: 't2' }], page: { after: null } } });
        } else await route.fulfill({ status: 401, json: { status: 401, code: 'HTTP_401', message: 'synthetic-error' } });
      });
      if (variant === 'session-401-refresh-ok') {
        await p.page.route('**/v1/auth/login-sessions/synthetic-session/refresh', async (route) => {
          if (route.request().method() !== 'POST') return route.fallback();
          p.network.requests.push({ method: 'POST', path: '/v1/auth/login-sessions/synthetic-session/refresh', body: route.request().postDataJSON() });
          await route.fulfill({ json: unrestricted(sessionFor('superadmin', true)) });
        });
      } else p.network.setVariants({ refresh: '401' });
      // The harness principal is limited to the synthetic tenant and workspace; the shell filters tenants and
      // workspaces by those memberships, so this journey seeds a principal without limits to reach t2.
      const { sessionFor } = await import('../fixtures/shell.ts');
      const unrestricted = (session) => { session.principal.tenantIds = []; session.principal.workspaceIds = []; return session; };
      await p.page.addInitScript((session) => { sessionStorage.setItem('in-falcone.console-shell-session', JSON.stringify(session)); }, unrestricted(sessionFor('superadmin')));
      await p.page.addInitScript(streamMock, streamFixtures['realtime-sse-mongo']);
      await p.page.goto(server.url('console/realtime/changes'));
      await p.page.getByRole('combobox', { name: locale === 'es' ? 'Organización activa' : 'Active tenant' }).selectOption('synthetic-tenant');
      await fill(p); await subscribe(p);
      await expect(rows(p)).toHaveCount(3);
      await p.page.getByRole('combobox', { name: locale === 'es' ? 'Organización activa' : 'Active tenant' }).selectOption('t2');
      const retained = async () => {
        await expect(surface(p).getByLabel(copy(p).database, { exact: true })).toHaveValue(' app_db ');
        await expect(surface(p).getByLabel(copy(p).collection, { exact: true })).toHaveValue('orders');
        await expect(surface(p).getByLabel(copy(p).anonKey, { exact: true })).toHaveValue(apiKey);
      };
      if (variant === 'session-401-refresh-ok') {
        await expect.poll(() => t2.length).toBe(2);
        expect(t2.map((call) => ({ method: call.method, url: call.url, body: call.body }))).toEqual([{ method: 'GET', url: t2Path, body: null }, { method: 'GET', url: t2Path, body: null }]);
        expect(t2[1].authorization).toBe('Bearer synthetic-refreshed-access-token');
        await expect(p.page).not.toHaveURL(/\/login$/);
        await retained();
        expect(p.network.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/refresh'))).toHaveLength(1);
      } else {
        await expect(p.page).toHaveURL(/\/login$/);
        expect(t2).toHaveLength(1);
        expect(await p.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(new URL(server.url('console/realtime/changes')).pathname);
      }
      // The stream is closed once, and no stream GET follows the switch or the redirect.
      const calls = await p.page.evaluate(() => window.__streamCalls ?? []);
      if (calls.length) { expect(calls).toHaveLength(1); expect(calls[0].aborted).toBe(true); }
    });
  });
}
