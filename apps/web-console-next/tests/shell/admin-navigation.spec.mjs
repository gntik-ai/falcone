import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startServer } from '../csp/server.mjs';
import { installSession } from '../browser-session.mjs';
import { assertAccessibility, assertResponsive, awaitTransitions } from '../parity/checks.mjs';

let server;
test.beforeAll(async () => { server = await startServer(); });
test.afterAll(async () => { await server?.close(); });

const copy = {
  en: { admin: 'Admin console', console: 'Console', about: 'About', signOut: 'Sign out', trigger: 'User menu' },
  es: { admin: 'Consola de administración', console: 'Consola', about: 'Acerca de', signOut: 'Cerrar sesión', trigger: 'Menú de usuario' },
};
const pathname = (page) => new URL(page.url()).pathname;
async function setup(page, locale, roles = ['superadmin']) {
  const unmatched = await installSession(page, roles);
  await page.addInitScript((language) => localStorage.setItem('falcone-next-locale', language), locale);
  await page.goto(server.url('console/overview'));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: copy[locale].trigger })).toBeVisible();
  return unmatched;
}
async function tabTo(page, locator) {
  // A finite traversal catches entries accidentally removed from the tab order.
  for (let step = 0; step < 50; step++) {
    await page.keyboard.press('Tab');
    if (await locator.evaluate((element) => element === document.activeElement)) return;
  }
  await expect(locator).toBeFocused();
}

for (const locale of ['en', 'es']) {
  const text = copy[locale];
  test(`superadmin menu and topbar preserve /next without document navigation in ${locale}`, async ({ page }) => {
    const unmatched = await setup(page, locale);
    expect(pathname(page)).toBe('/next/console/overview');
    const documents = [];
    page.on('request', (request) => { if (request.resourceType() === 'document') documents.push(request.url()); });
    const trigger = () => page.getByRole('button', { name: text.trigger });
    await trigger().click();
    await expect(page.getByRole('menuitem')).toHaveText([text.admin, text.about, text.signOut]);
    await page.getByRole('menuitem', { name: text.admin, exact: true }).click();
    await expect(page).toHaveURL(server.url('admin'));
    await trigger().click();
    await expect(page.getByRole('menuitem')).toHaveText([text.console, text.about, text.signOut]);
    await expect(page.getByRole('menuitem', { name: text.admin, exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: text.admin, exact: true })).toHaveCount(0);
    await page.getByRole('menuitem', { name: text.console, exact: true }).click();
    await expect(page).toHaveURL(server.url('console/overview'));
    const entry = page.getByRole('link', { name: text.admin, exact: true });
    await expect(entry).toHaveAttribute('href', '/next/admin');
    await expect(entry.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    await entry.click();
    await expect(page).toHaveURL(server.url('admin'));
    expect(documents).toEqual([]);
    expect(unmatched).toEqual([]);
  });

  test(`mobile shell entry leaves the flow-history breadcrumb clickable in ${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    const unmatched = await setup(page, locale);
    await page.goto(server.url('console/flows/f1/runs/e1'));
    const runs = page.getByRole('link', { name: locale === 'es' ? 'Ejecuciones' : 'Runs', exact: true });
    await expect(runs).toBeVisible();
    await runs.click({ trial: true });
    const documents = [];
    page.on('request', (request) => { if (request.resourceType() === 'document') documents.push(request.url()); });
    const entry = page.getByRole('link', { name: text.admin, exact: true });
    await expect(entry).toBeVisible();
    await entry.click();
    await expect(page).toHaveURL(server.url('admin'));
    expect(documents).toEqual([]);
    expect(unmatched).toEqual([]);
  });

  for (const openKey of ['Enter', 'Space']) {
    test(`keyboard navigation opens both menus with ${openKey} in ${locale}`, async ({ page }) => {
      const unmatched = await setup(page, locale);
      const documents = [];
      page.on('request', (request) => { if (request.resourceType() === 'document') documents.push(request.url()); });
      await tabTo(page, page.getByRole('link', { name: text.admin, exact: true }));
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(server.url('admin'));
      for (const [label, destination] of [[text.console, 'console/overview'], [text.admin, 'admin']]) {
        await tabTo(page, page.getByRole('button', { name: text.trigger }));
        await page.keyboard.press(openKey);
        const item = page.getByRole('menuitem', { name: label, exact: true });
        await expect(item).toBeVisible();
        // ArrowDown/ArrowUp must use the kit's roving focus and return to the first item.
        await expect(item).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(page.getByRole('menuitem', { name: text.about, exact: true })).toBeFocused();
        await page.keyboard.press('ArrowUp');
        await expect(item).toBeFocused();
        await expect(item).toHaveAccessibleName(label);
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(server.url(destination));
      }
      expect(documents).toEqual([]);
      expect(unmatched).toEqual([]);
    });
  }

  test(`closed menus meet the accessibility gate and open menus add no all-impact violations in ${locale}`, async ({ page, context }) => {
    const baselinePage = await context.newPage();
    const baselineRequests = await setup(baselinePage, locale, ['tenant_owner']);
    await baselinePage.getByRole('button', { name: text.trigger }).click();
    await expect(baselinePage.getByRole('menu')).toBeVisible();
    await awaitTransitions(baselinePage);
    const baseline = await new AxeBuilder({ page: baselinePage }).analyze();
    const baselineIds = new Set(baseline.violations.map((violation) => violation.id));
    expect(baselineRequests).toEqual([]);
    await baselinePage.close();

    const unmatched = await setup(page, locale);
    for (const [route, label] of [['console/overview', text.admin], ['admin', text.console]]) {
      await page.goto(server.url(route));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('menu')).toHaveCount(0);
      await assertAccessibility({ page });
      await page.getByRole('button', { name: text.trigger }).click();
      await expect(page.getByRole('menuitem', { name: label, exact: true })).toBeVisible();
      await awaitTransitions(page);
      const result = await new AxeBuilder({ page }).analyze();
      expect(result.violations.map((violation) => violation.id).filter((id) => !baselineIds.has(id))).toEqual([]);
      for (const violation of result.violations) {
        for (const node of violation.nodes) {
          const touchesEntry = await page.locator(node.target.join(' ')).evaluate((element, name) =>
            [...document.querySelectorAll('[role="menuitem"], a')].some((entry) =>
              // An existing violation on the menu container is not a violation on each item.
              entry.textContent.trim() === name && (entry === element || entry.contains(element))), label);
          expect(touchesEntry, `${violation.id} must not affect a new navigation entry`).toBe(false);
        }
      }
    }
    expect(unmatched).toEqual([]);
  });

  // Each width is measured with the menu opened at that width: a menu left open across a resize keeps its old
  // popover position and would report a desktop-sized scrollWidth, so it is closed before every resize.
  for (const [role, route, entry] of [
    ['superadmin', 'console/overview', 'admin'], ['superadmin', 'admin', 'console'],
    ['tenant_owner', 'console/overview', 'about'], ['tenant_owner', 'admin', null],
  ]) {
    test(`${role} has no horizontal overflow on ${route} at 375, 768 and 1280 px with the menu closed and opened at each width in ${locale}`, async ({ page }) => {
      const widths = [375, 768, 1280];
      const height = 900;
      await page.setViewportSize({ width: widths[0], height });
      const unmatched = await setup(page, locale, [role]);
      await page.goto(server.url(route));
      const label = entry && text[entry];
      const trigger = page.getByRole('button', { name: text.trigger });
      const adminLink = page.getByRole('link', { name: text.admin, exact: true });
      const adminItem = page.getByRole('menuitem', { name: text.admin, exact: true });
      const measure = () => page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      for (const width of widths) {
        await expect(page.getByRole('menu')).toHaveCount(0);
        await page.setViewportSize({ width, height });
        await expect(page.getByRole('main')).toBeVisible();
        // Only a viewport that was set while the menu was closed counts as evidence for the opened state below.
        expect(page.viewportSize()).toEqual({ width, height });
        const tag = `${locale}-${role}-${route.replace('/', '-')}-${width}`;
        const measured = { closed: await measure() };
        await assertResponsive({ page }, width);
        if (role === 'superadmin' && route === 'console/overview') {
          await expect(adminLink).toBeVisible();
          await expect(adminLink).toHaveAttribute('href', '/next/admin');
        } else await expect(adminLink).toHaveCount(0);
        await test.info().attach(`${tag}-closed`, { body: await page.screenshot(), contentType: 'image/png' });
        if (entry) {
          await trigger.click();
          if (entry === 'about') {
            await expect(page.getByRole('menuitem')).toHaveText([text.about, text.signOut]);
            await expect(adminItem).toHaveCount(0);
            await expect(page.getByRole('menuitem', { name: text.console, exact: true })).toHaveCount(0);
          } else await expect(page.getByRole('menuitem', { name: label, exact: true })).toHaveAccessibleName(label);
          const item = page.getByRole('menuitem', { name: label, exact: true });
          await expect(item).toBeVisible();
          // The popover position is not asserted, only that the item lies inside the viewport.
          await expect(async () => {
            const box = await item.boundingBox();
            expect(box).not.toBeNull();
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.y).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(width);
            expect(box.y + box.height).toBeLessThanOrEqual(height);
          }).toPass();
          measured.open = await measure();
          await assertResponsive({ page }, width);
          await test.info().attach(`${tag}-open`, { body: await page.screenshot(), contentType: 'image/png' });
          await page.keyboard.press('Escape');
          await expect(page.getByRole('menu')).toHaveCount(0);
        } else await expect(trigger).toHaveCount(0);
        await test.info().attach(`${tag}-sizes`, { body: JSON.stringify({ locale, role, route, width, ...measured }), contentType: 'application/json' });
      }
      expect(unmatched).toEqual([]);
    });
  }
}
