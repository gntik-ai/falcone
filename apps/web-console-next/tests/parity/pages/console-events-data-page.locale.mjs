import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
export const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-events-data-page.json`, import.meta.url), 'utf8'))]));
export const copy = (parity) => bundles[parity.locale];
export async function assertEventsLocale(parity) {
  await expect(parity.page.locator('html')).toHaveAttribute('lang', parity.locale);
  const values = await parity.page.getByTestId('console-events-data-page').evaluate((root) => {
    const result = [];
    for (const element of [root, ...root.querySelectorAll('*')]) {
      const style = getComputedStyle(element);
      if (['SCRIPT', 'STYLE'].includes(element.tagName) || style.display === 'none' || style.visibility === 'hidden' || !element.getClientRects().length) continue;
      for (const name of ['aria-label', 'title', 'placeholder', 'alt']) if (element.hasAttribute(name)) result.push(element.getAttribute(name));
      for (const child of element.childNodes) if (child.nodeType === Node.TEXT_NODE) result.push(child.textContent);
    }
    return result.map((text) => text.replace(/\s+/g, ' ').trim()).filter(Boolean);
  });
  const forbidden = new Set(['Search…', 'Search...', 'No results found', 'Loading…', 'Select an option']);
  if (parity.locale === 'es') for (const key of Object.keys(bundles.en)) if (bundles.en[key] !== bundles.es[key] && !bundles.en[key].includes('{')) forbidden.add(bundles.en[key]);
  expect(values.filter((text) => forbidden.has(text) || text.startsWith('pages.console-events-data-page.'))).toEqual([]);
}
