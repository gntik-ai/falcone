import { expect } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flowRecord } from './console-flow-designer-page.manifest.ts';

const flatten = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => typeof value === 'string' ? [[prefix + key, value]] : flatten(value, `${prefix}${key}.`));
const kitEnglish = ['Search...', 'Search…', 'No results found.', 'No results found', 'Loading...', 'Loading…', 'Toggle sidebar', 'Open menu', 'Close menu', 'Select an option', 'Select workspace', 'Previous page', 'Next page'];
export async function assertDesignerLocale(parity) {
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
  const values = await parity.page.evaluate(collectDesignerLocaleValues, flowRecord.definition.apiVersion);
  const bad = values.filter((text) => /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/.test(text) || (parity.locale === 'es' && forbidden.has(text)));
  expect(bad, `locale: unexpected copy ${bad.join(', ')}`).toEqual([]);
}

// Keep the whole-page scan from checks.mjs, except this schema-owned YAML value.
// Attribute labels and every value outside the rendered code remain checked.
export function collectDesignerLocaleValues(apiVersion) {
  const values = [];
  for (const element of document.body.querySelectorAll('*')) {
    const style = getComputedStyle(element);
    if (['SCRIPT', 'STYLE'].includes(element.tagName) || style.display === 'none' || style.visibility === 'hidden' || !element.getClientRects().length) continue;
    for (const attribute of ['aria-label', 'title', 'placeholder', 'alt']) {
      if (element.hasAttribute(attribute)) values.push(element.getAttribute(attribute));
    }
    for (const id of (element.getAttribute('aria-labelledby') ?? '').split(/\s+/)) if (id) values.push(document.getElementById(id)?.textContent ?? '');
    const addText = (text) => {
      const line = element.closest('[data-testid="monaco-yaml-surface"] .view-lines .view-line');
      const isSchemaVersion = line?.textContent.replace(/\s+/g, ' ').trim() === `apiVersion: ${apiVersion}`;
      if (text.trim() === apiVersion && isSchemaVersion) return;
      values.push(text);
    };
    for (const child of element.childNodes) if (child.nodeType === Node.TEXT_NODE) addText(child.textContent);
    if (typeof element.innerText === 'string') addText(element.innerText);
    if (element.matches('input[type="button"], input[type="submit"], input[type="reset"]')) values.push(element.value);
  }
  return values.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
