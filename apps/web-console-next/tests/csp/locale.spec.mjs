import { installSession } from '../browser-session.mjs';
import { test, expect } from '@playwright/test';
import { startServer } from './server.mjs';

let server;
test.use({ locale: 'en-US' });
test.beforeAll(async () => { server = await startServer(); });
test.afterAll(async () => { await server?.close(); });
test.beforeEach(async ({ page }) => { await installSession(page); });

test('English is the browser-independent default; menu preference and Intl samples survive reload', async ({ page }) => {
  const external = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== server.origin) external.push(request.url());
  });
  await page.goto(server.url('console/settings'));
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Page pending' })).toBeVisible();
  await expect(page.getByText('1234.5', { exact: true })).toBeVisible();
  await expect(page.getByText('January 2, 2026', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'User menu' }).click();
  const language = page.getByRole('combobox', { name: 'Language' }).first();
  await expect(language.getByRole('option')).toHaveText(['Spanish', 'English']);
  await language.selectOption('es');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('navigation', { name: 'Ruta de navegación', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Página pendiente' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Acerca de' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('1234,5', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('heading', { name: 'Página pendiente' })).toBeVisible();
  await expect(page.getByText('1234,5', { exact: true })).toBeVisible();
  expect(external).toEqual([]);
});

test('settings control changes locale and corrupt storage recovers safely', async ({ page }) => {
  await page.goto(server.url('console/settings'));
  const language = page.getByRole('combobox', { name: 'Language' });
  await expect(language.getByRole('option')).toHaveText(['Spanish', 'English']);
  await language.selectOption('es');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('img', { name: 'Consola', exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.setItem('falcone-next-locale', '{broken'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Page pending' })).toBeVisible();
});
