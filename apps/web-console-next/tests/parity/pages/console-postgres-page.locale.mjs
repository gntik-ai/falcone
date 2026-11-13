import { expect } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ddlPreviewFixture, paths } from './console-postgres-page.manifest.ts';

const flatten = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => typeof value === 'string' ? [[prefix + key, value]] : flatten(value, `${prefix}${key}.`));
const kitEnglish = ['Search...', 'Search…', 'No results found.', 'No results found', 'Loading...', 'Loading…', 'Toggle sidebar', 'Open menu', 'Close menu', 'Select an option', 'Select workspace', 'Previous page', 'Next page'];
export async function assertPostgresLocale(parity) {
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
  const copy = JSON.parse(await readFile(resolve(appRoot, `src/locales/${parity.locale}/pages.console-postgres-page.json`), 'utf8'));
  const values = await parity.page.evaluate(collectPostgresLocaleValues, {
    stateLabel: copy.state, activeLabel: copy.enums.active, lockTargetsLabel: copy.lockTargets,
    defaultLabel: copy.default, columnsId: `pg-${paths.columns}`,
    warningCategories: ddlPreviewFixture().preExecutionWarnings.map(({ category }) => copy.enums[category]),
    statementCategories: ddlPreviewFixture().ddlPreview.statements.map(({ category }) => copy.enums[category]),
    inventoryIds: ['databases', 'schemas', 'tables', 'views', 'matviews'].map((kind) => `pg-${paths[kind]}`),
    lockTargets: ddlPreviewFixture().ddlPreview.lockTargets,
  });
  const bad = values.filter((text) => /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/.test(text) || (parity.locale === 'es' && forbidden.has(text)));
  expect(bad, `locale: unexpected copy ${bad.join(', ')}`).toEqual([]);
}

// Keep checks.mjs's whole-page scan. Legacy formatLabel renders "active" as "Active"
// in both locales; DDL lock targets are verbatim SQL identifiers, not translation keys.
// The legacy Default column header is also intentional catalog copy.
// Exempt these exact values only in their fields; keep attributes and all other UI copy checked.
export function collectPostgresLocaleValues({ stateLabel, activeLabel, lockTargetsLabel, inventoryIds, lockTargets, defaultLabel, columnsId, warningCategories, statementCategories }) {
  const values = [];
  for (const element of document.body.querySelectorAll('*')) {
    const style = getComputedStyle(element);
    if (['SCRIPT', 'STYLE'].includes(element.tagName) || style.display === 'none' || style.visibility === 'hidden' || !element.getClientRects().length) continue;
    for (const attribute of ['aria-label', 'title', 'placeholder', 'alt']) {
      if (element.hasAttribute(attribute)) values.push(element.getAttribute(attribute));
    }
    for (const id of (element.getAttribute('aria-labelledby') ?? '').split(/\s+/)) if (id) values.push(document.getElementById(id)?.textContent ?? '');
    const addText = (text) => {
      const normalized = text.replace(/\s+/g, ' ').trim();
      const cell = element.closest('td');
      const inventory = cell?.closest('section[id]');
      const stateHeader = cell?.closest('table')?.querySelector('thead tr')?.children[1];
      const interactive = 'button, a, input, select, textarea, [role="button"]';
      const stateData = cell && (element === cell || element.matches('span')) && !cell.querySelector(interactive);
      if (normalized === activeLabel && stateData && inventoryIds.includes(inventory?.id) &&
          cell.cellIndex === 1 && stateHeader?.textContent.trim() === stateLabel) return;
      const header = element.closest('th[data-column-id="default"]');
      if (normalized === defaultLabel && header?.closest('section[id]')?.id === columnsId &&
          !header.querySelector(interactive)) return;
      if (!element.querySelector(interactive) &&
          ((warningCategories.includes(normalized) && element.matches('[data-testid="pg-preview"] [data-severity] > div > span[data-tone]')) ||
           (statementCategories.includes(normalized) && element.matches('[data-testid="pg-preview"] article > div > span[data-tone]')))) return;
      const group = element.matches('div') ? element : element.closest('div');
      const lockData = group && (element === group || element.matches('span[data-tone]')) &&
        group.children.length && [...group.children].every((child) => child.matches('span[data-tone]') && !child.querySelector(interactive));
      if (lockTargets.includes(normalized) && lockData && group.closest('[data-testid="pg-preview"]') &&
          group.previousElementSibling?.textContent.trim() === lockTargetsLabel) return;
      values.push(text);
    };
    for (const child of element.childNodes) if (child.nodeType === Node.TEXT_NODE) addText(child.textContent);
    if (typeof element.innerText === 'string') addText(element.innerText);
    if (element.matches('input[type="button"], input[type="submit"], input[type="reset"]')) values.push(element.value);
  }
  return values.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
