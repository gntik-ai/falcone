import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '../harness.mjs';
import { awaitTransitions } from '../checks.mjs';

// Attach the shared frame states alongside the page journeys for operator review.
for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`ConsoleShell visual review ${locale} ${width}`, () => {
    // A short viewport exercises the scrolling main at every responsive breakpoint.
    test.use({ locale, viewport: { width, height: 480 } });
    test('drawer, theme and keyboard main states', async ({ parity }, info) => {
      await parity.open('/console/overview', { tenants: 'overview-summaries', tenant: 'overview-summaries' });
      const names = locale === 'es'
        ? { heading: 'Vista general de la consola', overview: 'Vista general', main: 'Contenido principal', theme: /^Tema: /, open: 'Abrir navegación', nav: 'Navegación de consola' }
        : { heading: 'Console overview', overview: 'Overview', main: 'Main content', theme: /^Theme: /, open: 'Open navigation', nav: 'Console navigation' };
      const main = parity.page.getByRole('main', { name: names.main, exact: true });
      const theme = parity.page.getByRole('button', { name: names.theme });
      const capture = async (state) => {
        await awaitTransitions(parity.page);
        await info.attach(`shell-${state}-${locale}-${width}`, { body: await parity.page.screenshot(), contentType: 'image/png' });
      };
      const axe = async () => {
        const result = await new AxeBuilder({ page: parity.page }).analyze();
        expect(result.violations.filter((v) => v.id === 'scrollable-region-focusable' || ['serious', 'critical'].includes(v.impact))).toEqual([]);
      };
      await expect(main.getByRole('heading', { name: names.heading, exact: true })).toBeVisible();
      await expect(main).toHaveAttribute('tabindex', '0');
      await expect(theme).toHaveCount(1);
      await capture('dark');
      await axe();
      await theme.click();
      await expect(parity.page.locator('html')).not.toHaveClass(/\bdark\b/);
      expect(await parity.page.evaluate(() => localStorage.getItem('falcone-next-theme'))).toBe('light');
      await capture('light');
      await axe();
      await theme.click();
      await expect(parity.page.locator('html')).toHaveClass(/\bdark\b/);
      expect(await parity.page.evaluate(() => localStorage.getItem('falcone-next-theme'))).toBe('dark');
      // The theme button precedes main in the Tab order at each breakpoint.
      await theme.focus();
      await parity.page.keyboard.press('Tab');
      await expect(main).toBeFocused();
      await capture('main-focus');
      if (width < 1024) {
        await parity.page.getByRole('button', { name: names.open, exact: true }).click();
        const drawer = parity.page.getByRole('dialog');
        await expect(drawer.getByRole('navigation', { name: names.nav })).toBeVisible();
        await capture('drawer');
        await axe();
        await drawer.getByRole('link', { name: names.overview, exact: true }).click();
        await expect(drawer).toHaveCount(0);
      }
    });
  });
}
