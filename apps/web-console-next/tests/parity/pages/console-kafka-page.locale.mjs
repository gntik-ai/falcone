import { expect } from '../settled-expect.mjs';
import { readdir, readFile } from 'node:fs/promises';
import { fixtures, legacyJourneyFixtures } from './console-kafka-page.manifest.ts';
const flatten = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => typeof value === 'string' ? [[prefix + key, value]] : value && typeof value === 'object' ? flatten(value, `${prefix}${key}.`) : []);
export async function assertKafkaLocale(parity) {
  await expect(parity.page.locator('html')).toHaveAttribute('lang', parity.locale);
  const forbidden = new Set(['Search...', 'Search…', 'No results found.', 'Loading...', 'Loading…', 'Toggle sidebar', 'Open menu', 'Select an option', 'Previous page', 'Next page']);
  const data = new Set(flatten({ ...fixtures, legacyJourneyFixtures }).map(([, value]) => value));
  const englishDir = new URL('../../../src/locales/en/', import.meta.url);
  for (const file of await readdir(englishDir)) {
    if (!file.endsWith('.json')) continue;
    const english = flatten(JSON.parse(await readFile(new URL(file, englishDir), 'utf8')));
    const spanish = new Map(flatten(JSON.parse(await readFile(new URL(`../../../src/locales/es/${file}`, import.meta.url), 'utf8'))));
    for (const [key, value] of english) {
      if (value === spanish.get(key)) data.add(value);
      else if (parity.locale === 'es' && !value.includes('{')) forbidden.add(value);
    }
  }
  // Only exact fixture values and bilingual technical literals may resemble translation keys.
  // All labels, placeholders, accessible names and ordinary product copy remain checked.
  const common = JSON.parse(await readFile(new URL(`../../../src/locales/${parity.locale}/common.json`, import.meta.url), 'utf8'));
  const values = await parity.page.evaluate(collectKafkaLocaleValues, { contextLabel: common.shell.context, workspaceLabel: common.shell.workspace });
  expect(values.filter((value) => forbidden.has(value) || (/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/.test(value) && !data.has(value))), 'localized Kafka chrome with explicit technical data exceptions').toEqual([]);
}

export function collectKafkaLocaleValues({ contextLabel, workspaceLabel }) {
  const values = [];
  for (const element of document.body.querySelectorAll('*')) {
    if (!element.getClientRects().length || ['SCRIPT', 'STYLE'].includes(element.tagName)) continue;
    const style = getComputedStyle(element); if (style.display === 'none' || style.visibility === 'hidden') continue;
    for (const name of ['aria-label', 'title', 'placeholder', 'alt']) if (element.hasAttribute(name)) values.push(element.getAttribute(name));
    for (const id of (element.getAttribute('aria-labelledby') ?? '').split(/\s+/)) if (id) values.push(document.getElementById(id)?.textContent ?? '');
    const addText = (text) => {
      // Kit 0.12's existing shell picker hard-codes this empty-selection fallback.
      // Shell changes are outside Kafka's scope. Exempt only that trigger's text;
      // Kafka content, portals, all attributes and every other shell value stay checked.
      const trigger = element.closest('button');
      if (text.replace(/\s+/g, ' ').trim() === 'Select workspace' &&
          !element.closest('[data-testid="console-kafka-page"]') &&
          trigger?.getAttribute('aria-label') === workspaceLabel &&
          trigger.closest('section')?.getAttribute('aria-label') === contextLabel) return;
      values.push(text);
    };
    for (const child of element.childNodes) if (child.nodeType === Node.TEXT_NODE) addText(child.textContent);
    if (typeof element.innerText === 'string') addText(element.innerText);
  }
  return values.map((value) => value.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
