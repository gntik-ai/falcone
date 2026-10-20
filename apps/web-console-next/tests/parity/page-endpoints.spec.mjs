import { test, expect } from './harness.mjs';
import manifest from './fixtures/page.ts';

for (const role of manifest.roles) for (const locale of ['es', 'en']) {
  test.describe(`page endpoints | ${role} | ${locale}`, () => {
    test.use({ role, locale });
    test('a page registers fixtures alongside the shell', async ({ parity }) => {
      parity.network.registerEndpoints(manifest.endpoints);
      await parity.open(manifest.route);
      await expect(parity.page.getByRole('heading', { name: 'Synthetic page data' })).toBeVisible();
      await expect(parity.page.getByText(role, { exact: true })).toBeVisible();
      expect(parity.network.requests.some(({ path }) => path === '/v1/synthetic-page')).toBe(true);
    });
    test('a delayed page endpoint shows loading first', async ({ parity }) => {
      parity.network.registerEndpoints(manifest.endpoints);
      await parity.open(manifest.route, { page: { delayMs: 2000 } }, { waitForReady: false });
      await expect.poll(() => parity.network.requests.some(({ path }) => path === '/v1/synthetic-page')).toBe(true);
      await expect(parity.page.getByRole('heading', { name: locale === 'es' ? 'Cargando' : 'Loading' })).toBeVisible();
      await expect(parity.page.getByRole('heading', { name: 'Synthetic page data' })).toBeVisible();
    });
    test('a failed page endpoint succeeds after retry', async ({ parity }) => {
      parity.network.registerEndpoints(manifest.endpoints);
      await parity.open(manifest.route, { page: { sequence: ['500', 'success'] } });
      await expect(parity.page.getByRole('heading', { name: locale === 'es' ? 'Error del servidor' : 'Server error' })).toBeVisible();
      await parity.page.getByRole('button', { name: locale === 'es' ? 'Reintentar' : 'Retry', exact: true }).click();
      await expect(parity.page.getByRole('heading', { name: 'Synthetic page data' })).toBeVisible();
      expect(parity.network.requests.filter(({ path }) => path === '/v1/synthetic-page')).toHaveLength(2);
    });
  });
}
