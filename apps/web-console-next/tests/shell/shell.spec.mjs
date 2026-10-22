import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startServer } from '../csp/server.mjs';
import { installSession } from '../browser-session.mjs';
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
  await expect(page.getByText('500', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Navegación de consola' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/synthetic-render-failure|\bat https?:|Error:|Stack trace/);
  await page.getByRole('button', { name: 'Menú de usuario' }).click();
  await page.getByRole('menuitem', { name: 'Acerca de' }).click();
  await expect(page.getByRole('dialog')).toContainText('1.2.3 · 0123456');
  expect(unmatched).toEqual([]);
});

for (const width of [375, 768, 1280]) {
  for (const [path, heading] of [
    ['overview', 'Resumen'], ['__fixture/forbidden', 'Acceso denegado'],
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
  await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir navegación', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual([]);
  expect(unmatched).toEqual([]);
});
