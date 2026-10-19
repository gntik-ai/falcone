import { test, expect } from './harness.mjs';
import manifest from './pages/overview.manifest.ts';
import { visualReview } from './checks.mjs';

test('open waits for the lazy page and the shell context independently', async ({ parity }) => {
  await parity.page.route('**/assets/overview-*.js', async (route) => {
    await expect(parity.page.getByRole('region', { name: 'Contexto activo', exact: true })).toHaveAttribute('aria-busy', 'false');
    await expect(parity.page.locator('main section[aria-busy="true"]')).toBeVisible();
    await new Promise((done) => setTimeout(done, 250));
    await route.continue();
  });
  await parity.open(manifest.route);
  await expect(parity.page.locator('main section[aria-busy="true"]')).toHaveCount(0);
  await expect(parity.page.getByRole('heading', { name: 'Resumen', exact: true })).toBeVisible();
});

test('visual-review compares fresh documents with the same clock and random seed', async ({ parity }, info) => {
  await parity.page.addInitScript(() => {
    sessionStorage.setItem('synthetic-render-count', String(Number(sessionStorage.getItem('synthetic-render-count') ?? 0) + 1));
    window.__syntheticRender = { time: Date.now(), random: Math.random() };
  });
  const renders = [];
  await parity.page.route('**/assets/overview-*.js', async (route) => {
    renders.push(await parity.page.evaluate(() => window.__syntheticRender));
    await route.continue();
  });
  await visualReview(parity, manifest, info);
  expect(await parity.page.evaluate(() => sessionStorage.getItem('synthetic-render-count'))).toBe('2');
  expect(renders).toHaveLength(2);
  expect(renders[0].time).toBe(Date.parse('2026-06-01T12:00:00Z'));
  expect(renders[1]).toEqual(renders[0]);
});
