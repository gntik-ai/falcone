import { expect } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const flatten = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => typeof value === 'string' ? [[prefix + key, value]] : flatten(value, `${prefix}${key}.`));
const kitEnglish = ['Search...', 'Search…', 'No results found.', 'No results found', 'Loading...', 'Loading…', 'Toggle sidebar', 'Open menu', 'Close menu', 'Select an option', 'Select workspace', 'Previous page', 'Next page'];
// Same scan as checks.mjs assertLocale, with the page's data values marked as data. Only these are
// exempt: the schema.table heading, and non-interactive cells of the fixture rows tables.
// Attributes, labels, buttons and every other visible string stay checked.
export async function assertPostgresDataLocale(parity) {
  const appRoot = fileURLToPath(new URL('../../../', import.meta.url));
  await expect(parity.page.locator('html'), 'locale: document language').toHaveAttribute('lang', parity.locale);
  const forbidden = new Set(kitEnglish);
  if (parity.locale === 'es') {
    const dir = resolve(appRoot, 'src/locales/en');
    for (const file of await readdir(dir)) {
      if (!file.endsWith('.json')) continue;
      const english = flatten(JSON.parse(await readFile(resolve(dir, file), 'utf8')));
      const spanish = new Map(flatten(JSON.parse(await readFile(resolve(appRoot, 'src/locales/es', file), 'utf8'))));
      for (const [key, value] of english) if (value !== spanish.get(key) && !value.includes('{')) forbidden.add(value);
    }
  }
  const values = await parity.page.evaluate(collectPostgresDataLocaleValues);
  const bad = values.filter((text) => /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/.test(text) || (parity.locale === 'es' && forbidden.has(text)));
  expect(bad, `locale: unexpected copy ${bad.join(', ')}`).toEqual([]);
}

export function collectPostgresDataLocaleValues() {
  const values = [];
  const interactive = 'button, a, input, select, textarea, [role="button"], [role="combobox"]';
  const dataSelector = '#pgdata-target-heading, [data-testid="pgdata-rows"] td, [data-testid="pgdata-preview"] td';
  const isData = (element) => {
    if (element.closest('#pgdata-target-heading')) return true;
    const cell = element.closest('[data-testid="pgdata-rows"] td, [data-testid="pgdata-preview"] td');
    return Boolean(cell) && !element.closest(interactive) && !element.querySelector(interactive);
  };
  for (const element of document.body.querySelectorAll('*')) {
    const style = getComputedStyle(element);
    if (['SCRIPT', 'STYLE'].includes(element.tagName) || style.display === 'none' || style.visibility === 'hidden' || !element.getClientRects().length) continue;
    for (const attribute of ['aria-label', 'title', 'placeholder', 'alt']) {
      if (element.hasAttribute(attribute)) values.push(element.getAttribute(attribute));
    }
    for (const id of (element.getAttribute('aria-labelledby') ?? '').split(/\s+/)) if (id) values.push(document.getElementById(id)?.textContent ?? '');
    if (!isData(element)) {
      for (const child of element.childNodes) if (child.nodeType === Node.TEXT_NODE) values.push(child.textContent);
      // An ancestor's innerText repeats its descendants' text, data included; those descendants are
      // visited on their own, so only elements that contain no data contribute their innerText.
      if (typeof element.innerText === 'string' && !element.querySelector(dataSelector)) values.push(element.innerText);
    }
    if (element.matches('input[type="button"], input[type="submit"], input[type="reset"]')) values.push(element.value);
  }
  return values.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
