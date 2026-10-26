import { test, expect } from './harness.mjs';
import manifest from './pages/overview.manifest.ts';
import { pageManifest } from './fixtures/page.ts';
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
  await expect(parity.page.getByRole('heading', { name: 'Vista general de la consola', exact: true })).toBeVisible();
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

// Exercise a page's loading/error/retry UI against registered endpoints, without
// shipping a test page or opting a production route into migration.
async function mountRecordsPage(page) {
  await page.evaluate(() => {
    const section = document.createElement('section');
    section.setAttribute('aria-label', 'Synthetic records page');
    const output = document.createElement('p'); output.setAttribute('role', 'status');
    const retry = document.createElement('button'); retry.textContent = 'Retry synthetic records';
    const load = async () => {
      output.textContent = 'Loading synthetic records';
      try {
        const response = await fetch('/v1/synthetic-records');
        if (!response.ok) throw new Error('Synthetic response failure');
        output.textContent = (await response.json()).label;
      } catch { output.textContent = 'Synthetic records error'; }
    };
    retry.onclick = load;
    section.append(output, retry); document.querySelector('main').append(section);
    void load();
  });
}

for (const role of pageManifest.roles) {
  test.describe(`page endpoints ${role}`, () => {
    test.use({ role, pageEndpoints: pageManifest.endpoints });
    test('delayed page endpoint displays loading before data', async ({ parity }) => {
      await parity.open('/console/overview');
      parity.network.setVariants({ records: { delayMs: 1000 } });
      await mountRecordsPage(parity.page);
      const region = parity.page.getByRole('region', { name: 'Synthetic records page' });
      await expect(region.getByRole('status')).toHaveText('Loading synthetic records');
      await expect(region.getByRole('status')).toHaveText(`Synthetic records for ${role}`);
    });
    test('failed page endpoint displays error and succeeds after retry', async ({ parity }) => {
      await parity.open('/console/overview');
      parity.network.setVariants({ records: ['500', 'success'] });
      await mountRecordsPage(parity.page);
      const region = parity.page.getByRole('region', { name: 'Synthetic records page' });
      await expect(region.getByRole('status')).toHaveText('Synthetic records error');
      await region.getByRole('button', { name: 'Retry synthetic records' }).click();
      await expect(region.getByRole('status')).toHaveText(`Synthetic records for ${role}`);
      expect(parity.network.requests.filter((request) => request.path === '/v1/synthetic-records')).toHaveLength(2);
    });
  });
}
