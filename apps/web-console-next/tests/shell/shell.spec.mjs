import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startServer } from '../csp/server.mjs';
import { installSession } from '../browser-session.mjs';
import { awaitTransitions } from '../parity/checks.mjs';
let server;
test.beforeAll(async () => { server = await startServer(); });
test.afterAll(async () => { await server?.close(); });

for (const mechanism of ['NavLink', 'navigate']) {
  test(`pending lazy navigation through ${mechanism} preserves the shell`, async ({ page }) => {
    const unmatched = await installSession(page);
    await page.addInitScript(() => localStorage.setItem('falcone-next-locale', 'es'));
    const errors = [], reactErrors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error' && /#426|suspended while responding to synchronous input/i.test(message.text())) reactErrors.push(message.text()); });
    await page.goto(server.url('console/__fixture/home'));
    // Each mechanism starts on a fresh document/module graph. The import resolves after 500 ms.
    await expect(page.getByRole('heading', { name: 'Prueba de navegación' })).toBeVisible();
    const started = Date.now();
    if (mechanism === 'NavLink') await page.getByRole('link', { name: 'Enlace diferido' }).click();
    else await page.getByRole('button', { name: 'Navegar diferido' }).click();
    await expect(page.getByRole('heading', { name: 'Destino diferido' })).toBeVisible();
    expect(Date.now() - started).toBeGreaterThanOrEqual(500);
    await expect(page.getByText('500', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Navegación de consola' })).toBeVisible();
    expect(errors).toEqual([]); expect(reactErrors).toEqual([]); expect(unmatched).toEqual([]);
  });
}

test('render errors retain navigation without stack text, and About shows build identity', async ({ page }) => {
  const unmatched = await installSession(page);
  await page.addInitScript(() => localStorage.setItem('falcone-next-locale', 'es'));
  await page.goto(server.url('console/__fixture/throw'));
  await expect(page.getByRole('heading', { name: 'Error del servidor', exact: true }).first()).toBeVisible();
  await expect(page.getByText('500', { exact: true }).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/req_8f2c41d07a9b|503|acme-web/);
  await expect(page.getByRole('navigation', { name: 'Navegación de consola' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/synthetic-render-failure|\bat https?:|Error:|Stack trace/);
  await page.getByRole('button', { name: 'Menú de usuario' }).click();
  await page.getByRole('menuitem', { name: 'Acerca de' }).click();
  await expect(page.getByRole('dialog')).toContainText('1.2.3 · 0123456');
  expect(unmatched).toEqual([]);
});

for (const width of [375, 768, 1280]) {
  for (const [path, heading] of [
    ['overview', 'Vista general de la consola'], ['__fixture/forbidden', 'Acceso denegado'],
    ['zzz', 'Sección de consola no encontrada'], ['__fixture/throw', 'Error del servidor'],
  ]) {
    test(`accessible ${path} at ${width}px`, async ({ page }) => {
      const unmatched = await installSession(page);
      await page.addInitScript(() => localStorage.setItem('falcone-next-locale', 'es'));
      await page.setViewportSize({ width, height: 900 });
      await page.goto(server.url(`console/${path}`));
      await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
      const result = await new AxeBuilder({ page }).analyze();
      expect(result.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual([]);
      expect(unmatched).toEqual([]);
    });
  }
}

test('the open mobile navigation drawer has no serious accessibility violations', async ({ page }) => {
  const unmatched = await installSession(page);
  await page.addInitScript(() => localStorage.setItem('falcone-next-locale', 'es'));
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(server.url('console/overview'));
  await expect(page.getByRole('heading', { name: 'Vista general de la consola' })).toBeVisible();
  const layoutTrigger = page.locator('.console-shell > div > header > button[aria-haspopup="dialog"]');
  await expect(layoutTrigger).toHaveCount(1);
  await expect(layoutTrigger).toBeHidden();
  await expect(page.getByRole('button', { name: 'Abrir navegación', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Abrir navegación', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual([]);
  expect(unmatched).toEqual([]);
});

for (const role of ['tenant_owner', 'superadmin']) {
  for (const width of [375, 768, 1280]) {
    test(`the user menu and Language submenu are accessible for ${role} at ${width}px`, async ({ page }, testInfo) => {
      const unmatched = await installSession(page, [role]);
      await page.addInitScript(() => localStorage.setItem('falcone-next-locale', 'es'));
      await page.setViewportSize({ width, height: 900 });
      await page.goto(server.url('console/overview'));
      await expect(page.getByRole('heading', { name: 'Vista general de la consola' })).toBeVisible();
      await page.getByRole('button', { name: 'Menú de usuario' }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await expect(page.getByRole('menu').locator('select, label, [role="combobox"]')).toHaveCount(0);
      await awaitTransitions(page);
      const menuScan = await new AxeBuilder({ page }).analyze();
      expect(menuScan.violations.filter((v) => v.id === 'aria-required-children' || ['serious', 'critical'].includes(v.impact))).toEqual([]);
      await page.getByRole('menuitem', { name: 'Idioma', exact: true }).click();
      await expect(page.getByRole('menuitemradio', { name: 'Español' })).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByRole('menuitemradio', { name: 'Inglés' })).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByRole('menuitemradio')).toHaveCount(2);
      await awaitTransitions(page);
      for (const item of await page.getByRole('menuitemradio').all()) {
        await expect(item).toBeInViewport({ ratio: 1 });
        const bounds = await item.boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      }
      const submenuScan = await new AxeBuilder({ page }).analyze();
      expect(submenuScan.violations.filter((v) => v.id === 'aria-required-children' || ['serious', 'critical'].includes(v.impact))).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath('language-submenu.png') });
      expect(unmatched).toEqual([]);
    });
  }

  for (const openKey of ['ArrowRight', 'Enter']) {
    test(`keyboard language selection with ${openKey} persists after reload for ${role}`, async ({ page }) => {
      const unmatched = await installSession(page, [role]);
      await page.addInitScript(() => {
        if (!localStorage.getItem('falcone-next-locale')) localStorage.setItem('falcone-next-locale', 'es');
      });
      await page.setViewportSize({ width: 375, height: 900 });
      await page.goto(server.url('console/overview'));
      await expect(page.getByRole('heading', { name: 'Vista general de la consola' })).toBeVisible();
      const trigger = page.getByRole('button', { name: 'Menú de usuario' });
      await trigger.focus();
      await trigger.press('Enter');
      const language = page.getByRole('menuitem', { name: 'Idioma', exact: true });
      await expect(language).toBeVisible();
      const itemCount = await page.getByRole('menuitem').count();
      for (let i = 0; i < itemCount; i++) {
        await page.keyboard.press('ArrowDown');
        if (await language.evaluate((element) => element === document.activeElement)) break;
      }
      await expect(language).toBeFocused();
      await page.keyboard.press(openKey);
      await expect(page.getByRole('menuitemradio', { name: 'Español' })).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('menuitemradio', { name: 'Inglés' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: 'Console overview' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      expect(await page.evaluate(() => localStorage.getItem('falcone-next-locale'))).toBe('en');
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Console overview' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await page.getByRole('button', { name: 'User menu' }).click();
      await page.getByRole('menuitem', { name: 'Language', exact: true }).click();
      await expect(page.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
      await page.getByRole('menuitemradio', { name: 'Spanish' }).click();
      await expect(page.getByRole('heading', { name: 'Vista general de la consola' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'es');
      expect(await page.evaluate(() => localStorage.getItem('falcone-next-locale'))).toBe('es');
      expect(unmatched).toEqual([]);
    });
  }
}
