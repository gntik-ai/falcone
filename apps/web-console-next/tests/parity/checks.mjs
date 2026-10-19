import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from '../run-cli.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const selector = (locator, locale) => typeof locator === 'string' ? locator : locator[locale];
const locate = (parity, locator) => parity.page.locator(selector(locator, parity.locale));
export async function data(parity, manifest) {
  await parity.open(manifest.route);
  for (const field of manifest.data) await expect(locate(parity, field.locator), `data: ${field.name}`).toBeVisible();
}
export async function action(parity, manifest) {
  for (const item of manifest.actions) {
    await parity.open(manifest.route);
    const start = parity.network.requests.length;
    for (const trigger of item.trigger) await locate(parity, trigger).click();
    await expect(locate(parity, item.outcome), `action: ${item.name} outcome`).toBeVisible();
    const sent = parity.network.requests.slice(start);
    expect(sent, `action: ${item.name} expected ${item.expected.method} ${item.expected.path}`).toContainEqual({ ...item.expected, body: item.expected.body });
  }
}
export async function errorEmpty(parity, manifest) {
  for (const state of manifest.states) {
    await parity.open(manifest.route, { [state.fixture]: state.variant });
    await expect(locate(parity, state.locator), `error-empty: ${state.fixture} ${state.variant}`).toBeVisible();
  }
}
export async function assertAccessibility(parity) {
  const result = await new AxeBuilder({ page: parity.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations.filter((v) => ['serious', 'critical'].includes(v.impact)), 'accessibility: serious/critical axe violations').toEqual([]);
}
export async function accessibility(parity, manifest) { await parity.open(manifest.route); await assertAccessibility(parity); }
export async function assertRuntimeHealth(parity) {
  // Drain browser tasks and pending event bindings before inspecting the monitor.
  await parity.page.evaluate(() => new Promise((done) => setTimeout(done, 0)));
  expect(parity.faults, `runtime-health: ${parity.faults.join('\n')}`).toEqual([]);
}
export async function runtimeHealth(parity, manifest) { await parity.open(manifest.route); await assertRuntimeHealth(parity); }
export async function assertResponsive(parity, width) {
  await parity.page.setViewportSize({ width, height: 900 });
  await expect(parity.page.getByRole('main'), `responsive: main at ${width}px`).toBeVisible();
  const sizes = await parity.page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(sizes.scrollWidth, `responsive: horizontal overflow at ${width}px`).toBeLessThanOrEqual(sizes.clientWidth);
}
export async function responsive(parity, manifest) {
  await parity.open(manifest.route);
  for (const width of [375, 768, 1280]) await assertResponsive(parity, width);
}
const flatten = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => typeof value === 'string' ? [[prefix + key, value]] : flatten(value, `${prefix}${key}.`));
const kitEnglish = ['Search...', 'Search…', 'No results found.', 'No results found', 'Loading...', 'Loading…', 'Toggle sidebar', 'Open menu', 'Close menu', 'Select an option', 'Select workspace', 'Previous page', 'Next page'];
export async function assertLocale(parity) {
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
  const values = await parity.page.evaluate(() => {
    const values = [];
    for (const element of document.body.querySelectorAll('*')) {
      const style = getComputedStyle(element);
      if (['SCRIPT', 'STYLE'].includes(element.tagName) || style.display === 'none' || style.visibility === 'hidden' || !element.getClientRects().length) continue;
      for (const attribute of ['aria-label', 'title', 'placeholder', 'alt']) {
        if (element.hasAttribute(attribute)) values.push(element.getAttribute(attribute));
      }
      for (const id of (element.getAttribute('aria-labelledby') ?? '').split(/\s+/)) if (id) values.push(document.getElementById(id)?.textContent ?? '');
      for (const child of element.childNodes) if (child.nodeType === Node.TEXT_NODE) values.push(child.textContent);
      if (typeof element.innerText === 'string') values.push(element.innerText);
      if (element.matches('input[type="button"], input[type="submit"], input[type="reset"]')) values.push(element.value);
    }
    return values.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  });
  const bad = values.filter((text) => /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/.test(text) || (parity.locale === 'es' && forbidden.has(text)));
  expect(bad, `locale: unexpected copy ${bad.join(', ')}`).toEqual([]);
}
export async function visualReview(parity, manifest, info, betweenPasses = async () => {}) {
  await parity.open(manifest.route);
  await assertLocale(parity);
  const baseline = info.snapshotPath('shell.png');
  await mkdir(dirname(baseline), { recursive: true });
  await writeFile(baseline, await parity.page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' }));
  await parity.open(manifest.route);
  await assertLocale(parity);
  await betweenPasses();
  await expect(parity.page).toHaveScreenshot('shell.png', { animations: 'disabled', caret: 'hide', scale: 'css', threshold: 0, maxDiffPixels: 0 });
}
export async function kitConformance(manifest) {
  expect(manifest.sources.length, 'kit-conformance: page sources must be declared').toBeGreaterThan(0);
  const result = await runCli(['scripts/lint-colours.mjs', ...manifest.sources]);
  expect(result.status, `kit-conformance: ${result.stderr}`).toBe(0);
}
