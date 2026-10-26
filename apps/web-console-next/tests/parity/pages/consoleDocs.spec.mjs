import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { docs, docsPath, note, createdNote, updatedNote } from './consoleDocs.manifest.ts';
import { buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';

const catalog = (locale) => JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-docs-page.json`, import.meta.url), 'utf8'));
const value = (text, replacements) => Object.entries(replacements).reduce((result, [key, replacement]) => result.replace(`{${key}}`, String(replacement)), text);
const calls = (parity) => parity.network.requests.filter((request) => request.path === docsPath && request.method === 'GET');
const copyButton = (page, copy) => page.getByRole('button', { name: copy.copy, exact: true });
const editNote = (page, copy, id = note.noteId) => page.locator('textarea').and(page.getByLabel(value(copy.editNote, { note: id }), { exact: true }));
const noteArticle = (page, copy) => page.locator('article').filter({ has: editNote(page, copy) });

async function configureWorkspaceFixtures(parity) {
  await parity.page.addInitScript(() => {
    const session = JSON.parse(sessionStorage.getItem('in-falcone.console-shell-session'));
    session.principal.workspaceIds = ['wrk-1', 'wrk-2'];
    sessionStorage.setItem('in-falcone.console-shell-session', JSON.stringify(session));
  });
  await parity.page.route('**/v1/workspaces?*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    parity.network.requests.push({ method: request.method(), path: url.pathname + url.search, body: undefined });
    const fixture = buildWorkspaceCollectionFixture();
    fixture.items = ['wrk-1', 'wrk-2'].map((id, index) => ({ ...fixture.items[0], workspaceId: id, displayName: index === 0 ? 'Synthetic workspace one' : 'Synthetic workspace two' }));
    await route.fulfill({ json: fixture });
  });
}

for (const role of manifest.roles) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  const copy = catalog(locale);
  test.describe(`consoleDocs | ${role} | ${locale} | ${width}`, () => {
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test.beforeEach(async ({ parity, server }) => {
      await configureWorkspaceFixtures(parity);
      parity.open = async (route, variants = {}) => {
        parity.network.setVariants(variants);
        await parity.page.goto(server.url(route.replace(/^\//, '')));
        await expect(parity.page.locator('.console-docs').getByRole('heading', { name: copy.title, exact: true, level: 1 })).toBeVisible();
        await expect(parity.page.locator('.console-docs [aria-busy="true"]')).toHaveCount(0);
        await expect(parity.page.getByRole('region', { name: locale === 'es' ? 'Contexto activo' : 'Active context', exact: true })).toHaveAttribute('aria-busy', 'false');
        await parity.page.evaluate(() => document.fonts.ready);
      };
    });
    test('data', async ({ parity }) => {
      await parity.open(manifest.route);
      const page = parity.page;
      await expect(page.getByRole('region', { name: copy.authRegion })).toBeVisible();
      await expect(page.getByRole('region', { name: copy.servicesRegion })).toBeVisible();
      for (const text of [docs.baseUrl, ...Object.values(docs.authInstructions), 'PostgreSQL', docs.enabledServices[0].endpoint, 'const x = 1']) await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
      await expect(page.getByRole('tablist', { name: value(copy.snippets, { service: 'PostgreSQL' }) })).toBeVisible();
      await expect(page.getByText(copy.port, { exact: true })).toHaveCount(1);
      await expect(page.getByText('synthetic-secret-reference', { exact: true })).toBeVisible();
      const timeline = page.getByRole('list', { name: copy.timeline });
      await expect(timeline.locator('li')).toHaveCount(3);
      await page.getByRole('button', { name: value(copy.earlier, { count: 1 }) }).click();
      await expect(timeline.locator('li')).toHaveCount(4);
      await expect(timeline.locator('li').first()).toContainText(copy.noteEdited);
      await expect(timeline.locator('li').first()).not.toContainText(docs.customNotes[1].authorId);
      await expect(timeline.locator('li').nth(1)).toContainText(docs.customNotes[1].authorId);
      await page.getByRole('button', { name: copy.fewer }).click();
      if (role === 'workspace_viewer') {
        await expect(page.getByText(copy.readOnly, { exact: true })).toBeVisible();
        await expect(page.getByRole('textbox')).toHaveCount(0);
        for (const name of [copy.add, copy.save, copy.delete]) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
      }
      expect(calls(parity)).toEqual([{ method: 'GET', path: docsPath, body: undefined }]);
      await check.assertLocale(parity);
      await parity.open(manifest.route, { 'workspace-docs.get': 'optional-fields-absent' });
      await expect(page.getByText(copy.tokenEndpoint, { exact: true })).toHaveCount(0);
      await expect(page.getByText(copy.port, { exact: true })).toHaveCount(0);
      await check.assertLocale(parity);
    });
    test('action', async ({ parity }) => {
      const page = parity.page;
      await parity.open(manifest.route);
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await copyButton(page, copy).click();
      await expect(page.getByRole('button', { name: copy.copied, exact: true })).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('const x = 1');
      await page.getByRole('tab', { name: 'Python', exact: true }).click();
      await expect(page.getByText('synthetic-secret-reference', { exact: true })).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole('tab', { name: 'Python', exact: true })).toHaveAttribute('aria-selected', 'true');
      const before = calls(parity).length;
      await page.getByRole('button', { name: copy.refreshLabel, exact: true }).click();
      await expect(page.getByText('bearer_oidc', { exact: true })).toBeVisible();
      expect(calls(parity)).toHaveLength(before + 1);
      if (role === 'workspace_admin') {
        const baseline = calls(parity).length;
        const composer = page.getByLabel(copy.newNote, { exact: true });
        await expect(page.getByRole('button', { name: copy.add, exact: true })).toBeDisabled();
        await composer.fill('   ');
        await expect(page.getByRole('button', { name: copy.add, exact: true })).toBeDisabled();
        parity.network.setVariants({ 'workspace-docs.notes.post': { delayMs: 350 } });
        await composer.fill(createdNote.content);
        await page.getByRole('button', { name: copy.add, exact: true }).click();
        await expect(page.getByRole('button', { name: copy.adding, exact: true })).toBeDisabled();
        await expect(composer).toBeDisabled();
        await expect(editNote(page, copy, createdNote.noteId)).toHaveValue(createdNote.content);
        await expect(composer).toHaveValue('');
        expect(parity.network.requests).toContainEqual({ method: 'POST', path: `${docsPath}/notes`, body: { content: createdNote.content } });
        parity.network.setVariants({ 'workspace-docs.notes.put': { delayMs: 350 } });
        await editNote(page, copy).fill(updatedNote.content);
        await noteArticle(page, copy).getByRole('button', { name: copy.save, exact: true }).click();
        await expect(page.getByRole('button', { name: copy.saving, exact: true })).toBeDisabled();
        await expect(editNote(page, copy)).toBeEnabled();
        expect(parity.network.requests).toContainEqual({ method: 'PUT', path: `${docsPath}/notes/${note.noteId}`, body: { content: updatedNote.content } });
        const trigger = noteArticle(page, copy).getByRole('button', { name: copy.delete, exact: true });
        // Cancel, Escape, success and failure each have independent focus assertions.
        await trigger.click();
        await page.getByRole('alertdialog').getByRole('button', { name: copy.cancel, exact: true }).click();
        await expect(trigger).toBeFocused();
        await trigger.click(); await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
        parity.network.setVariants({ 'workspace-docs.notes.delete': '500' });
        await trigger.click();
        const dialog = page.getByRole('alertdialog');
        await dialog.getByRole('button', { name: copy.confirm, exact: true }).click();
        await expect(dialog.getByRole('alert')).toHaveText(copy.deleteUnavailable);
        await expect(dialog.locator(':focus')).toHaveCount(1);
        await expect(composer).not.toHaveAttribute('aria-describedby');
        await expect(editNote(page, copy)).toHaveValue(updatedNote.content);
        await expect(page.getByRole('list', { name: copy.timeline, includeHidden: true })).toContainText(note.noteId);
        await dialog.getByRole('button', { name: copy.cancel, exact: true }).click();
        await expect(trigger).toBeFocused();
        parity.network.setVariants({});
        await trigger.click(); await dialog.getByRole('button', { name: copy.confirm, exact: true }).click();
        await expect(page.getByRole('heading', { name: copy.notes, exact: true })).toBeFocused();
        await expect(editNote(page, copy)).toHaveCount(0);
        await expect(page.getByRole('list', { name: copy.timeline })).not.toContainText(note.noteId);
        expect(parity.network.requests).toContainEqual({ method: 'DELETE', path: `${docsPath}/notes/${note.noteId}`, body: undefined });
        expect(calls(parity)).toHaveLength(baseline);
        for (const [action, expected] of [['post', copy.createError], ['put', copy.updateError]]) {
          await parity.open(manifest.route);
          parity.network.setVariants({ [`workspace-docs.notes.${action}`]: '500' });
          const input = action === 'post' ? page.getByRole('textbox', { name: copy.newNote, exact: true }) : editNote(page, copy);
          await input.fill('synthetic retained draft');
          await (action === 'post' ? page.getByRole('button', { name: copy.add, exact: true }) : noteArticle(page, copy).getByRole('button', { name: copy.save, exact: true })).click();
          await expect(page.getByRole('alert')).toContainText(expected);
          await expect(input).toHaveValue('synthetic retained draft');
          await expect(page.getByRole('textbox', { name: copy.newNote, exact: true })).toHaveAttribute('aria-describedby', 'workspace-doc-note-action-error');
          await check.assertLocale(parity);
        }
      }
      await parity.open(manifest.route, { 'workspace-docs.get': 'no-services' });
      await page.getByRole('link', { name: copy.settings, exact: true }).click();
      await expect(page).toHaveURL(/\/console\/settings$/);
    });
    test('error-empty', async ({ parity }) => {
      await check.errorEmpty(parity, manifest);
      await parity.open(manifest.route, { 'workspace-docs.get': 'no-notes' });
      await expect(parity.page.getByRole('list', { name: copy.timeline }).locator('li')).toHaveCount(1);
      await parity.open(manifest.route, { 'workspace-docs.get': 'no-services' });
      await expect(parity.page.getByRole('heading', { name: copy.noServices, exact: true })).toBeVisible();
      await expect(parity.page.getByRole('region', { name: copy.authRegion })).toBeVisible();
      await expect(parity.page.getByRole('heading', { name: copy.notes, exact: true })).toBeVisible();
      await check.assertLocale(parity);
      await parity.open(manifest.route, { 'workspace-docs.get': '500' });
      await expect(parity.page.getByText('synthetic-docs-request', { exact: true })).toBeVisible();
      parity.network.setVariants({});
      await parity.page.getByRole('button', { name: copy.retry, exact: true }).click();
      await expect(parity.page.getByText('bearer_oidc', { exact: true })).toBeVisible();
      parity.network.setVariants({ 'workspace-docs.get': 'network' });
      await parity.page.getByRole('button', { name: copy.refreshLabel, exact: true }).click();
      await expect(parity.page.getByRole('button', { name: copy.retry, exact: true })).toBeVisible();
      await expect(parity.page.getByText('bearer_oidc', { exact: true })).toHaveCount(0);
      await expect(parity.page.getByRole('list', { name: copy.timeline })).toHaveCount(0);
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      const hold = async (route) => { await held; await route.fallback(); };
      await parity.page.route(`**${docsPath}`, hold);
      try {
        await parity.page.reload();
        await expect(parity.page.getByText(copy.loading, { exact: true })).toHaveCount(1);
        await expect(parity.page.getByRole('status').filter({ hasText: copy.loading })).toHaveCount(1);
      } finally { release(); await parity.page.unroute(`**${docsPath}`, hold); }
    });
    test('accessibility', async ({ parity }) => {
      for (const variants of [{}, { 'workspace-docs.get': 'no-notes' }, { 'workspace-docs.get': 'no-services' }, { 'workspace-docs.get': '403' }, { 'workspace-docs.get': '404' }, { 'workspace-docs.get': '500' }]) {
        await parity.open(manifest.route, variants);
        await check.assertAccessibility(parity); await check.assertLocale(parity);
      }
      await parity.open(manifest.route);
      await parity.page.getByRole('tab', { name: 'Node.js', exact: true }).focus();
      await parity.page.keyboard.press('ArrowRight'); await parity.page.keyboard.press('Enter');
      await expect(parity.page.getByRole('tab', { name: 'Python', exact: true })).toHaveAttribute('aria-selected', 'true');
      if (role === 'workspace_admin') {
        await noteArticle(parity.page, copy).getByRole('button', { name: copy.delete, exact: true }).click();
        await check.assertAccessibility(parity); await check.assertLocale(parity);
      }
    });
    test('runtime-health', async ({ parity, server }) => {
      // Route IDs override a different stored workspace even when both are accessible.
      await parity.page.addInitScript(() => {
        const session = JSON.parse(sessionStorage.getItem('in-falcone.console-shell-session'));
        localStorage.setItem('in-falcone.console-active-context', JSON.stringify({ userId: session.principal.userId, tenantId: 'synthetic-tenant', workspaceId: 'wrk-2', updatedAt: '2026-06-01T12:00:00Z' }));
      });
      await parity.open(manifest.route);
      await expect(parity.page.getByRole('region', { name: locale === 'es' ? 'Contexto activo' : 'Active context', exact: true })).toContainText('Synthetic workspace one');
      expect(calls(parity)).toHaveLength(1);
      expect(parity.network.requests.filter((request) => request.path === '/v1/workspaces/wrk-2/docs')).toEqual([]);
      await expect(parity.page.locator('.console-docs')).toBeVisible();
      const breadcrumb = parity.page.getByRole('navigation', { name: locale === 'es' ? 'Ruta de navegación' : 'Breadcrumbs', exact: true });
      await expect(breadcrumb).toHaveCount(1);
      expect(await breadcrumb.locator('a').evaluateAll((links) => links.map((link) => new URL(link.href).pathname.replace(/^\/next/, '')))).toEqual(['/console/overview', '/console/workspaces', '/console/workspaces/wrk-1']);
      await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText(locale === 'es' ? 'Documentación' : 'Documentation');
      await check.assertRuntimeHealth(parity);
      // The legacy dashboard is a pending route; enter the page via its shell breadcrumb link target.
      await parity.page.goto(server.url('console/workspaces/wrk-1'));
      await parity.page.evaluate((route) => { const link = document.createElement('a'); link.href = route; link.textContent = 'Synthetic docs entry'; document.body.append(link); }, server.url('console/workspaces/wrk-1/docs'));
      await parity.page.getByRole('link', { name: 'Synthetic docs entry', exact: true }).click();
      await expect(parity.page.getByRole('heading', { name: copy.title, exact: true })).toBeVisible();
      await check.assertRuntimeHealth(parity);
    });
    test('responsive', async ({ parity }) => {
      await parity.open(manifest.route);
      await check.assertResponsive(parity, width);
      await parity.page.getByRole('button', { name: value(copy.earlier, { count: 1 }) }).click();
      await check.assertResponsive(parity, width);
      await parity.open(manifest.route, { 'workspace-docs.get': 'long-values' });
      await check.assertResponsive(parity, width);
    });
    test('visual-review', async ({ parity }, info) => {
      for (const [state, variant] of [['loaded', 'success'], ['optional-fields-absent', 'optional-fields-absent'], ['no-notes', 'no-notes'], ['no-services', 'no-services'], ['error', '500']]) {
        await parity.open(manifest.route, { 'workspace-docs.get': variant });
        await check.assertLocale(parity);
        const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
        const hash = createHash('sha256').update(body).digest('hex');
        await info.attach(`${state}-${locale}-${width}-sha256-${hash}`, { body, contentType: 'image/png' });
      }
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      const hold = async (route) => { await held; await route.fallback(); };
      await parity.page.route(`**${docsPath}`, hold);
      try {
        await parity.page.reload();
        await expect(parity.page.getByText(copy.loading, { exact: true })).toBeVisible();
        await check.assertLocale(parity);
        const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
        const hash = createHash('sha256').update(body).digest('hex');
        await info.attach(`loading-${locale}-${width}-sha256-${hash}`, { body, contentType: 'image/png' });
      } finally { release(); await parity.page.unroute(`**${docsPath}`, hold); }
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
  });
  test.describe(`consoleDocs session and verbatim (${role}, ${locale}, ${width})`, () => {
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test('401 refresh and redirect', async ({ parity, server }) => {
      parity.network.setVariants({ 'workspace-docs.get': '401' });
      const url = server.url(manifest.route.replace(/^\//, ''));
      await parity.page.goto(url);
      await expect(parity.page).toHaveURL(/\/login$/);
      expect(parity.network.requests.filter((request) => request.path.endsWith('/refresh'))).toHaveLength(1);
      expect(calls(parity)).toHaveLength(2);
      expect(await parity.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(new URL(url).pathname);
    });
    test('server Settings stays byte-identical, separately from assertLocale', async ({ parity, server }) => {
      parity.network.setVariants({ 'workspace-docs.get': 'verbatim' });
      await parity.page.goto(server.url(manifest.route.replace(/^\//, '')));
      for (const text of [docs.baseUrl, ...Object.values({ ...docs.authInstructions, consoleRef: 'Settings' }), 'PostgreSQL', 'pg.example.test', 'const x = 1']) await expect(parity.page.getByText(text, { exact: true }).first()).toBeVisible();
      await expect(parity.page.getByRole('button', { name: copy.refreshLabel, exact: true })).toBeVisible();
    });
  });
}
