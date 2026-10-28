import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { docs, note, secondNote, createdNote, updatedNote } from './console-docs-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import { sessionFor } from '../fixtures/shell.ts';
import * as check from '../checks.mjs';

const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-docs-page.json`, import.meta.url), 'utf8'))]));
const build = JSON.parse(readFileSync(new URL('../../../dist/.vite/manifest.json', import.meta.url), 'utf8'));
const entry = Object.values(build).find((chunk) => chunk.isEntry && chunk.name === 'app').file;
const label = (p, key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), bundles[p.locale][key]);
const button = (p, key, values) => p.page.getByRole('button', { name: label(p, key, values), exact: true });
const notes = (p) => p.page.getByRole('region', { name: label(p, 'notesRegion'), exact: true });
const timeline = (p) => p.page.getByRole('list', { name: label(p, 'timeline'), exact: true });
const composer = (p) => notes(p).getByRole('textbox', { name: label(p, 'newNote'), exact: true });
const editor = (p) => notes(p).getByRole('textbox', { name: label(p, 'editNote', { noteId: note.noteId }), exact: true });
const docsRequests = (p) => p.network.requests.filter((r) => /\/docs(?:\/|$)/.test(r.path));
async function loaded(p) { await expect(p.page.getByRole('region', { name: label(p, 'authRegion'), exact: true })).toBeVisible(); }
async function openDelete(p) { await notes(p).getByRole('button', { name: label(p, 'delete'), exact: true }).first().click(); await expect(p.page.getByRole('alertdialog')).toBeVisible(); }
async function announce(p, key, politeness = 'polite') { await expect(p.page.locator(`[data-live-announcer="${politeness}"]`)).toContainText([label(p, key)]); }
async function expand(p) { await button(p, 'earlier', { count: 1 }).click(); }
async function attach(p, info, state, width) {
  const body = await p.page.screenshot({ fullPage: true, animations: 'disabled' });
  const hash = createHash('sha256').update(body).digest('hex');
  await info.attach(`${state}-${p.locale}-${width}-sha256-${hash}`, { body, contentType: 'image/png' });
}
async function holdRequest(p, path, run) {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const hold = async (route) => { await held; await route.fallback(); };
  await p.page.route(`**${path}`, hold);
  try { await run(release); } finally { release(); await p.page.unroute(`**${path}`, hold); }
}

for (const role of manifest.roles) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-docs-page | ${role} | ${locale} | ${width}`, () => {
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test('data', async ({ parity: p }) => {
      await check.data(p, manifest); await loaded(p);
      await expect(p.page.getByText(docs.baseUrl, { exact: true })).toBeVisible();
      const auth = p.page.getByRole('region', { name: label(p, 'authRegion'), exact: true });
      for (const value of Object.values(docs.authInstructions)) await expect(auth.getByText(value, { exact: true })).toBeVisible();
      for (const key of ['method', 'tokenEndpoint', 'clientId', 'clientSecret', 'scopes', 'consoleRef']) await expect(auth.locator('dt', { hasText: label(p, key) })).toHaveCount(1);
      await expect(p.page.getByText('5432', { exact: true })).toBeVisible();
      await expect(p.page.locator('dt', { hasText: label(p, 'port') })).toHaveCount(1);
      for (const service of docs.enabledServices) {
        await expect(p.page.getByRole('heading', { name: service.label, level: 3, exact: true })).toBeVisible();
        await expect(p.page.getByText(service.endpoint, { exact: true })).toBeVisible();
        await expect(p.page.getByRole('tablist', { name: label(p, 'snippetTabs', { service: service.label }), exact: true })).toBeVisible();
      }
      for (const value of [note, secondNote]) await expect(notes(p).getByText(value.authorId, { exact: true })).toBeVisible();
      await expect(p.page.getByText('Synthetic secret placeholder guidance', { exact: true })).toBeVisible();
      await expand(p);
      const entries = timeline(p).getByRole('listitem');
      await expect(entries).toHaveCount(4);
      expect(await entries.locator('time').evaluateAll((times) => times.map((time) => time.dateTime))).toEqual(['2026-06-01T11:30:00.000Z', '2026-06-01T11:00:00.000Z', '2026-06-01T10:00:00.000Z', '2026-06-01T09:00:00.000Z']);
      await expect(entries.nth(1)).toContainText(label(p, 'noteEdited'));
      await expect(entries.nth(1)).not.toContainText(note.authorId);
      await expect(entries.nth(2)).toContainText(note.authorId);
      await button(p, 'fewer').click(); await expect(entries).toHaveCount(3);
      await check.assertLocale(p);
      await p.open(manifest.route, { 'docs.get': 'optional-fields-absent' });
      await expect(p.page.locator('dt', { hasText: label(p, 'tokenEndpoint') })).toHaveCount(0);
      await expect(p.page.locator('dt', { hasText: label(p, 'port') })).toHaveCount(0);
      await check.assertLocale(p);
    });
    test('action', async ({ parity: p }) => {
      await p.open(manifest.route); await loaded(p);
      expect(docsRequests(p)).toEqual([{ method: 'GET', path: '/v1/workspaces/wrk-1/docs', body: undefined }]);
      await button(p, 'refreshLabel').click(); await loaded(p);
      expect(docsRequests(p)).toHaveLength(2);
      const targetTab = p.page.getByRole('tab', { name: 'Synthetic SDK example', exact: true });
      await targetTab.click(); await expect(targetTab).toHaveAttribute('aria-selected', 'true');
      await expect(p.page.getByText('Synthetic secret placeholder guidance', { exact: true })).toHaveCount(0);
      expect(await p.page.evaluate(() => sessionStorage.getItem('docs-snippet-tab-synthetic-sql'))).toBe('synthetic-sdk');
      await p.page.reload(); await loaded(p); await expect(targetTab).toHaveAttribute('aria-selected', 'true');
      await p.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await button(p, 'copyLabel', { label: 'Synthetic SDK example' }).click();
      await expect(button(p, 'copied')).toBeVisible(); await announce(p, 'copied');
      expect(await p.page.evaluate(() => navigator.clipboard.readText())).toBe(docs.enabledServices[0].snippets[1].code);
      if (role === 'workspace_admin') {
        await composer(p).fill('   '); await expect(button(p, 'add')).toBeDisabled();
        const start = docsRequests(p).length;
        await holdRequest(p, '/v1/workspaces/wrk-1/docs/notes', async (release) => {
          await composer(p).fill(createdNote.content); await button(p, 'add').click();
          await expect(button(p, 'adding')).toBeDisabled(); await expect(composer(p)).toBeDisabled();
          for (const key of ['save', 'delete']) for (const control of await notes(p).getByRole('button', { name: label(p, key), exact: true }).all()) await expect(control).toBeDisabled();
          release(); await expect(composer(p)).toHaveValue('');
        });
        await expect(notes(p).getByRole('textbox', { name: label(p, 'editNote', { noteId: createdNote.noteId }), exact: true })).toHaveValue(createdNote.content);
        await expect(timeline(p)).toContainText(createdNote.noteId); await announce(p, 'created');
        await holdRequest(p, `/v1/workspaces/wrk-1/docs/notes/${note.noteId}`, async (release) => {
          await editor(p).fill(updatedNote.content); await notes(p).getByRole('button', { name: label(p, 'save'), exact: true }).first().click();
          await expect(button(p, 'saving')).toBeDisabled(); await expect(composer(p)).toBeDisabled(); release();
          await expect(button(p, 'saving')).toHaveCount(0);
        });
        await announce(p, 'updated'); await expect(editor(p)).toHaveValue(updatedNote.content);
        await expect(timeline(p).getByRole('listitem').first()).toContainText(label(p, 'noteEdited'));
        await openDelete(p); await button(p, 'confirm').click(); await expect(p.page.getByRole('alertdialog')).toHaveCount(0);
        await expect(notes(p).getByRole('heading', { name: label(p, 'notes'), exact: true })).toBeFocused();
        await expect(editor(p)).toHaveCount(0); await expect(timeline(p)).not.toContainText(note.noteId); await announce(p, 'deleted');
        expect(docsRequests(p).slice(start)).toEqual([
          { method: 'POST', path: '/v1/workspaces/wrk-1/docs/notes', body: { content: createdNote.content } },
          { method: 'PUT', path: `/v1/workspaces/wrk-1/docs/notes/${note.noteId}`, body: { content: updatedNote.content } },
          { method: 'DELETE', path: `/v1/workspaces/wrk-1/docs/notes/${note.noteId}`, body: undefined },
        ]);
      } else {
        await expect(notes(p).getByText(label(p, 'readOnly'), { exact: true })).toBeVisible();
        await expect(notes(p).getByRole('textbox')).toHaveCount(0);
        for (const key of ['add', 'save', 'delete']) await expect(button(p, key)).toHaveCount(0);
      }
      await p.open(manifest.route, { 'docs.get': 'no-services' });
      await expect(p.page.getByRole('link', { name: label(p, 'settings'), exact: true })).toHaveAttribute('href', '/console/settings');
      await p.page.getByRole('link', { name: label(p, 'settings'), exact: true }).click(); await expect(p.page).toHaveURL(/\/console\/settings$/);
      await check.assertRuntimeHealth(p);
    });
    test('error-empty', async ({ parity: p, server }) => {
      await check.errorEmpty(p, manifest);
      await p.open(manifest.route, { 'docs.get': 'empty' }); await expect(timeline(p).getByRole('listitem')).toHaveCount(1);
      await p.open(manifest.route, { 'docs.get': 'missing-timestamps' }); await expect(p.page.getByText(label(p, 'noActivity'), { exact: true })).toBeVisible();
      await p.open(manifest.route, { 'docs.get': 'no-services' }); await expect(p.page.getByText(label(p, 'noServices'), { exact: true })).toBeVisible(); await loaded(p);
      for (const variant of ['500', 'network']) {
        await p.open(manifest.route, { 'docs.get': [variant, 'success'] });
        await expect(p.page.getByRole('heading', { name: label(p, 'errorTitle'), exact: true })).toBeVisible();
        await expect(timeline(p)).toHaveCount(0);
        if (variant === '500') await expect(p.page.getByText('synthetic-docs-request', { exact: true })).toBeVisible();
        await button(p, 'retry').click(); await loaded(p);
      }
      await holdRequest(p, '/v1/workspaces/wrk-1/docs', async (release) => {
        await p.page.goto(server.url(manifest.route.slice(1)));
        await expect(p.page.locator('[role="status"][aria-busy="true"]')).toContainText(label(p, 'loading'));
        await expect(timeline(p)).toHaveCount(0); release(); await loaded(p);
      });
      if (role === 'workspace_admin') {
        for (const action of ['create', 'update']) {
          await p.open(manifest.route, { [`docs.${action}`]: '500' });
          await composer(p).fill('Synthetic preserved draft');
          if (action === 'create') await button(p, 'add').click(); else await notes(p).getByRole('button', { name: label(p, 'save'), exact: true }).first().click();
          await expect(notes(p).getByRole('alert')).toHaveText(label(p, action === 'create' ? 'createError' : 'updateError'));
          await expect(composer(p)).toHaveAttribute('aria-describedby', 'workspace-doc-note-action-error');
          await expect(composer(p)).toHaveValue('Synthetic preserved draft'); await expect(composer(p)).toBeEnabled();
          await announce(p, action === 'create' ? 'createError' : 'updateError', 'assertive');
        }
        await p.open(manifest.route, { 'docs.delete': '500' }); await openDelete(p); await button(p, 'confirm').click();
        const dialog = p.page.getByRole('alertdialog');
        await expect(dialog.getByRole('alert')).toHaveText(label(p, 'delete500'));
        await expect(dialog).toBeVisible(); await announce(p, 'delete500', 'assertive');
        expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
        // Inert background controls stay enabled during deletion; query the DOM directly.
        expect(await p.page.locator('textarea').first().getAttribute('aria-describedby')).toBeNull();
        expect(await p.page.locator('textarea').nth(1).inputValue()).toBe(note.content);
        await expect(p.page.locator('ol[aria-label]').last()).toContainText(note.noteId);
      }
    });
    test('accessibility', async ({ parity: p }) => {
      await p.open(manifest.route); await loaded(p); await check.assertAccessibility(p); await check.assertLocale(p);
      const services = p.page.getByRole('region', { name: label(p, 'services'), exact: true });
      await expect(services.getByRole('heading', { name: label(p, 'services'), level: 2, exact: true })).toBeVisible();
      await expect(services.getByRole('heading', { level: 3 })).toHaveCount(docs.enabledServices.length);
      for (const service of docs.enabledServices) await expect(services.getByRole('heading', { name: service.label, level: 3, exact: true })).toBeVisible();
      expect(await p.page.getByRole('heading').evaluateAll((headings) => headings.every((heading) => heading.textContent.trim()))).toBe(true);
      const tabs = p.page.getByRole('tablist', { name: label(p, 'snippetTabs', { service: docs.enabledServices[0].label }), exact: true });
      await tabs.getByRole('tab').first().focus(); await p.page.keyboard.press('ArrowRight'); await p.page.keyboard.press('Enter');
      await expect(tabs.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
      await button(p, 'earlier', { count: 1 }).focus(); await p.page.keyboard.press('Enter'); await expect(button(p, 'fewer')).toBeFocused();
      const breadcrumb = p.page.getByRole('navigation').filter({ has: p.page.locator('ol [aria-current="page"]') });
      await expect(breadcrumb).toHaveCount(1);
      for (const href of ['/console/overview', '/console/workspaces', '/console/workspaces/wrk-1']) await expect(breadcrumb.locator(`a[href="${href}"]`)).toHaveCount(1);
      if (role === 'workspace_admin') {
        await openDelete(p); await check.assertAccessibility(p); await button(p, 'cancel').click();
      }
      await p.open(manifest.route, { 'docs.get': 'no-services' }); await check.assertAccessibility(p); await check.assertLocale(p);
    });
    test('runtime-health', async ({ parity: p, server }) => {
      // Seed immediately before the entry runs so the harness cannot clear the mismatch.
      const seed = async (route) => {
        await p.page.evaluate((session) => {
          session.principal.workspaceIds = ['wrk-1', 'wrk-2'];
          sessionStorage.setItem('in-falcone.console-shell-session', JSON.stringify(session));
          localStorage.setItem('in-falcone.console-active-context', JSON.stringify({ userId: session.principal.userId, tenantId: 'synthetic-tenant', workspaceId: 'wrk-2', updatedAt: '2026-06-01T12:00:00Z' }));
        }, sessionFor(role));
        await route.fallback();
      };
      const workspaces = async (route) => route.fulfill({ json: { items: [
        { workspaceId: 'wrk-1', tenantId: 'synthetic-tenant', displayName: 'wrk-1', status: 'active' },
        { workspaceId: 'wrk-2', tenantId: 'synthetic-tenant', displayName: 'wrk-2', status: 'active' },
      ], page: { after: null } } });
      await p.page.route(`**/${entry}`, seed); await p.page.route('**/v1/workspaces?**', workspaces);
      try {
        await p.open(manifest.route); await loaded(p);
        expect(docsRequests(p)).toEqual([{ method: 'GET', path: '/v1/workspaces/wrk-1/docs', body: undefined }]);
        const context = p.page.getByRole('region', { name: locale === 'es' ? 'Contexto activo' : 'Active context', exact: true });
        await expect(context).toContainText('wrk-1');
        expect(await p.page.evaluate(() => JSON.parse(localStorage.getItem('in-falcone.console-active-context')).workspaceId)).toBe('wrk-1');
        await expect(p.page.getByText(locale === 'es' ? 'Página pendiente de migración' : 'Page awaiting migration', { exact: true })).toHaveCount(0);
        await check.assertRuntimeHealth(p);
      } finally { await p.page.unroute(`**/${entry}`, seed); await p.page.unroute('**/v1/workspaces?**', workspaces); }
      await p.page.goto(server.url(manifest.route.slice(1))); await loaded(p); await check.assertRuntimeHealth(p);
    });
    test('responsive', async ({ parity: p }) => {
      await p.open(manifest.route); await loaded(p); await check.assertResponsive(p, width);
      await p.page.getByRole('tab', { name: 'Synthetic SDK example', exact: true }).click(); await check.assertResponsive(p, width);
      if (role === 'workspace_admin') { await openDelete(p); await check.assertResponsive(p, width); }
    });
    test('visual-review', async ({ parity: p, server }, info) => {
      for (const [state, variant] of [['loaded', 'success'], ['optional-fields-absent', 'optional-fields-absent'], ['no-notes', 'empty'], ['no-services', 'no-services'], ['error', '500']]) {
        await p.open(manifest.route, { 'docs.get': variant }); await check.assertLocale(p); await attach(p, info, `${state}-${role}`, width);
      }
      await holdRequest(p, '/v1/workspaces/wrk-1/docs', async () => {
        await p.page.goto(server.url(manifest.route.slice(1)));
        await expect(p.page.locator('[role="status"][aria-busy="true"]')).toContainText(label(p, 'loading'));
        await check.assertLocale(p); await attach(p, info, `loading-${role}`, width);
      });
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });

  });
  test.describe(`console-docs-page interactions (${role}, ${locale}, ${width})`, () => {
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    // Verbatim server values deliberately bypass assertLocale ("Settings" is valid data).
    test('preserves server values byte-for-byte in both locales', async ({ parity: p }) => {
      await p.open(manifest.route, { 'docs.get': 'verbatim' }); await loaded(p);
      const auth = p.page.getByRole('region', { name: label(p, 'authRegion'), exact: true });
      for (const value of Object.values({ ...docs.authInstructions, consoleRef: 'Settings' })) await expect(auth.getByText(value, { exact: true })).toHaveText(value);
      for (const service of docs.enabledServices) {
        await expect(p.page.getByRole('heading', { name: service.label, level: 3, exact: true })).toHaveText(service.label);
        await expect(p.page.getByText(service.endpoint, { exact: true })).toHaveText(service.endpoint);
        for (const snippet of service.snippets) {
          await p.page.getByRole('tab', { name: snippet.label, exact: true }).click();
          expect(await p.page.getByRole('region', { name: label(p, 'snippetCode', { service: service.label }), exact: true }).locator('code').textContent()).toBe(snippet.code);
        }
      }
      await expect(button(p, 'refreshLabel')).toHaveText(label(p, 'refresh'));
    });
    if (role === 'workspace_admin') {
      for (const cancel of ['cancel', 'Escape']) test(`delete cancellation via ${cancel} restores focus`, async ({ parity: p }) => {
        await p.open(manifest.route); await loaded(p);
        const trigger = notes(p).getByRole('button', { name: label(p, 'delete'), exact: true }).first();
        await trigger.click(); await expect(p.page.getByRole('alertdialog')).toBeVisible();
        if (cancel === 'Escape') await p.page.keyboard.press('Escape'); else await button(p, 'cancel').click();
        await expect(p.page.getByRole('alertdialog')).toHaveCount(0); await expect(trigger).toBeFocused();
        expect(docsRequests(p).filter((r) => r.method === 'DELETE')).toEqual([]);
      });
      test('pending delete disables only dialog controls and successful delete focuses the heading', async ({ parity: p }) => {
        await p.open(manifest.route); await loaded(p); await openDelete(p);
        await holdRequest(p, `/v1/workspaces/wrk-1/docs/notes/${note.noteId}`, async (release) => {
          await button(p, 'confirm').click(); await expect(button(p, 'confirming')).toBeDisabled(); await expect(button(p, 'cancel')).toBeDisabled();
          expect(await p.page.locator('textarea').evaluateAll((inputs) => inputs.every((input) => !input.disabled))).toBe(true);
          release(); await expect(p.page.getByRole('alertdialog')).toHaveCount(0);
        });
        await expect(notes(p).getByRole('heading', { name: label(p, 'notes'), exact: true })).toBeFocused();
      });
      test('failed delete keeps dialog focus', async ({ parity: p }) => {
        await p.open(manifest.route, { 'docs.delete': '500' }); await loaded(p); await openDelete(p); await button(p, 'confirm').click();
        await expect(p.page.getByRole('alertdialog').getByRole('alert')).toHaveText(label(p, 'delete500'));
        expect(await p.page.getByRole('alertdialog').evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
      });
    }
    test('401 refreshes once then redirects with return path', async ({ parity: p, server }) => {
      p.network.setVariants({ 'docs.get': '401' });
      await p.page.goto(server.url(manifest.route.slice(1))); await expect(p.page).toHaveURL(/\/login$/);
      expect(p.network.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/refresh'))).toHaveLength(1);
      expect(docsRequests(p)).toEqual(Array.from({ length: 2 }, () => ({ method: 'GET', path: '/v1/workspaces/wrk-1/docs', body: undefined })));
      expect(await p.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(new URL(server.url(manifest.route.slice(1))).pathname);
    });
  });
}

// Owners share the same permission predicate; exercise the write path with that exact platform role too.
test.describe('console-docs-page workspace owner', () => {
  test.use({ role: 'workspace_admin', pageEndpoints: manifest.endpoints });
  test('workspace_owner can create notes', async ({ parity: p }) => {
    const seed = async (route) => {
      const session = sessionFor('workspace_admin'); session.principal.platformRoles = ['workspace_owner'];
      await p.page.evaluate((value) => sessionStorage.setItem('in-falcone.console-shell-session', JSON.stringify(value)), session);
      await route.fallback();
    };
    await p.page.route(`**/${entry}`, seed);
    try {
      await p.open(manifest.route); await loaded(p); await composer(p).fill(createdNote.content); await button(p, 'add').click();
      await expect(composer(p)).toHaveValue(''); expect(docsRequests(p).at(-1)).toEqual({ method: 'POST', path: '/v1/workspaces/wrk-1/docs/notes', body: { content: createdNote.content } });
    } finally { await p.page.unroute(`**/${entry}`, seed); }
  });
});
