import { installSession } from '../browser-session.mjs';
import { test, expect } from '@playwright/test';
import { startServer } from './server.mjs';

let server;
test.use({ locale: 'en-US' });
test.beforeAll(async () => { server = await startServer(); });
test.afterAll(async () => { await server?.close(); });
test.beforeEach(async ({ page }) => { await installSession(page); });

test('English is the browser-independent default; menu preference survives reload', async ({ page }) => {
  const external = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== server.origin) external.push(request.url());
  });
  await page.goto(server.url('console/settings'));
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Console settings' })).toBeVisible();
  await page.getByRole('button', { name: 'User menu' }).click();
  const language = page.getByRole('combobox', { name: 'Language' }).first();
  await expect(language.getByRole('option')).toHaveText(['Spanish', 'English']);
  await language.selectOption('es');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('navigation', { name: 'Ruta de navegación', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ajustes de consola' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Acerca de' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('heading', { name: 'Ajustes de consola' })).toBeVisible();
  expect(external).toEqual([]);
});

test('settings control changes locale and corrupt storage recovers safely', async ({ page }) => {
  await page.goto(server.url('console/settings'));
  const language = page.getByRole('combobox', { name: 'Interface language' });
  await language.click();
  await page.getByRole('option', { name: 'Spanish', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('img', { name: 'Consola', exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.setItem('falcone-next-locale', '{broken'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Console settings' })).toBeVisible();
});

test('menu switches both directions on overview', async ({ page }) => {
  await page.goto(server.url('console/overview'));
  await page.getByRole('button', { name: 'User menu' }).click();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('es');
  await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Idioma' }).selectOption('en');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
});
