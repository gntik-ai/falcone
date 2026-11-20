import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { existsSync } from 'node:fs';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runCli } from '../run-cli.mjs';

// Under vitest/jsdom import.meta.url is not a file: URL, so the app root comes from the working directory (the package
// directory under `pnpm --filter ... exec`, or the repository root).
const appRoot = existsSync(resolve(process.cwd(), 'src/locales')) ? process.cwd() : resolve(process.cwd(), 'apps/web-console-next');
const selector = (locator, locale) => typeof locator === 'string' ? locator : locator[locale];
const locate = (parity, locator) => parity.page.locator(selector(locator, parity.locale));
// The ConsoleShell sidebar (context region, account menu) is display:none below lg and lives in the navigation drawer
// there. A manifest entry marked `sidebar` opens the drawer when the sidebar is not shown, and closes it after a read.
// Toasts are role=dialog too, so the drawer is the dialog that holds the navigation landmark, never a bare dialog query.
const drawer = (page) => page.getByRole('dialog').filter({ has: page.getByRole('navigation') });
export async function openSidebar(parity) {
  const { page, locale } = parity;
  const opener = page.getByRole('button', { name: locale === 'es' ? 'Abrir navegación' : 'Open navigation', exact: true });
  if (!(await opener.isVisible())) return false;
  await opener.click();
  await expect(drawer(page)).toBeVisible();
  return true;
}
export async function closeSidebar(parity) {
  await parity.page.keyboard.press('Escape');
  await expect(drawer(parity.page)).toHaveCount(0);
}
// The hidden sidebar and the open drawer both render the controls: only the one on screen counts.
const onScreen = (parity, locator) => locate(parity, locator).filter({ visible: true });
async function expectVisible(parity, entry, message) {
  const opened = entry.sidebar ? await openSidebar(parity) : false;
  await expect(entry.sidebar ? onScreen(parity, entry.locator) : locate(parity, entry.locator), message).toBeVisible();
  if (opened) await closeSidebar(parity);
}
// The strings the kit DataTable shows when rendered without rows, extracted from the pinned kit by
// scripts/extract-kit-sample-strings.mjs. Text that a mocked response or the user supplied is data, not sample data.
let sampleStrings;
async function loadSampleStrings() {
  if (!sampleStrings) {
    const { strings } = JSON.parse(await readFile(resolve(appRoot, 'tests/parity/kit-sample-strings.json'), 'utf8'));
    if (!Array.isArray(strings) || strings.length === 0) throw new Error('kit-sample-strings.json lists no strings');
    sampleStrings = strings;
  }
  return sampleStrings;
}
export async function assertNoSampleData(parity) {
  const samples = await loadSampleStrings();
  let shown;
  try {
    shown = await parity.page.evaluate((wanted) => {
      const sample = new Set(wanted), found = new Set();
      const walker = document.createTreeWalker(document.querySelector('main') ?? document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent.replace(/\s+/g, ' ').trim();
        if (sample.has(text) && node.parentElement?.checkVisibility?.({ visibilityProperty: true }) !== false) found.add(text);
      }
      return [...found];
    }, samples);
  } catch (error) {
    // A page that is closing or navigating has no settled state to inspect.
    if (parity.page.isClosed() || /Execution context was destroyed|Target (?:page|context|closed)|has been closed|navigat/i.test(String(error))) return;
    throw error;
  }
  const supplied = parity.network?.supplied ?? [];
  const stray = shown.filter((text) => !supplied.some((data) => data.includes(text)));
  if (stray.length) throw new Error(`sample-data: the page shows kit sample text that no response or input supplied: ${stray.join(', ')}`);
}
export async function data(parity, manifest) {
  await parity.open(manifest.route);
  for (const field of manifest.data) await expectVisible(parity, field, `data: ${field.name}`);
  await assertNoSampleData(parity);
}
export async function action(parity, manifest) {
  for (const item of manifest.actions) {
    await parity.open(manifest.route);
    const start = parity.network.requests.length;
    if (item.sidebar) await openSidebar(parity);
    for (const trigger of item.trigger) await (item.sidebar ? onScreen(parity, trigger) : locate(parity, trigger)).click();
    await expect(locate(parity, item.outcome), `action: ${item.name} outcome`).toBeVisible();
    const sent = parity.network.requests.slice(start);
    expect(sent, `action: ${item.name} expected ${item.expected.method} ${item.expected.path}`).toContainEqual({ ...item.expected, body: item.expected.body });
    await assertNoSampleData(parity);
  }
}
export async function errorEmpty(parity, manifest) {
  for (const state of manifest.states) {
    await parity.open(manifest.route, { [state.fixture]: state.variant });
    await expectVisible(parity, state, `error-empty: ${state.fixture} ${state.variant}`);
    await assertNoSampleData(parity);
  }
}
// Dialogs fade in and out. axe reads computed colours, so a scan taken halfway through a transition
// measures blended colours and reports contrast failures that do not exist at rest.
// The tenant picker is the kit select in the ConsoleShell sidebar header, which lives in the navigation drawer below lg.
export async function chooseTenant(parity, option) {
  const { page, locale } = parity;
  const picker = page.getByRole('combobox', { name: locale === 'es' ? 'Organización activa' : 'Active tenant', exact: true });
  const inDrawer = await openSidebar(parity);
  await picker.click();
  await page.getByRole('option', { name: option, exact: true }).click();
  if (inDrawer) await closeSidebar(parity);
}
// An open modal makes the rest of the page inert to pointer input, so a user click cannot reach the sidebar. Replay the
// pointer sequence as DOM events instead (the sidebar picker is in the DOM at every width, display:none below lg).
// The select opens in its own portal and the modal's focus handling can close it again between two steps, so the
// option is chosen in the same task in which it appears, and the sequence is repeated only while the option is not found.
export async function chooseTenantUnderModal(parity, option) {
  const { page, locale } = parity;
  const picker = page.locator('aside').getByRole('combobox', { name: locale === 'es' ? 'Organización activa' : 'Active tenant', exact: true, includeHidden: true });
  await expect(async () => {
    await picker.evaluate(async (element, name) => {
      const press = (target, types) => { for (const type of types) target.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, { bubbles: true, cancelable: true, button: 0 })); };
      const find = () => [...document.querySelectorAll('[role="option"]')].find((item) => item.textContent?.trim() === name);
      if (!find()) press(element, ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
      const started = Date.now();
      const item = await new Promise((resolve) => {
        const tick = () => { const found = find(); if (found || Date.now() - started > 2000) resolve(found); else requestAnimationFrame(tick); };
        tick();
      });
      if (!item) throw new Error('tenant picker did not open');
      press(item, ['pointerdown', 'click']);
    }, option);
  }).toPass({ timeout: 20_000 });
}
export async function awaitTransitions(page) {
  await page.evaluate(async () => {
    const frame = () => new Promise((done) => requestAnimationFrame(() => done()));
    // A transition starts one frame after the node mounts, so a single empty reading proves nothing: require
    // several consecutive frames with no finite animation running, within a bounded number of frames.
    let quiet = 0;
    for (let round = 0; round < 120 && quiet < 4; round += 1) {
      await frame();
      const running = document.getAnimations().filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime ?? 0) && animation.playState !== 'finished');
      if (running.length) { quiet = 0; await Promise.all(running.map((animation) => animation.finished.catch(() => undefined))); } else quiet += 1;
    }
  });
}
export async function assertAccessibility(parity) {
  await awaitTransitions(parity.page);
  const result = await new AxeBuilder({ page: parity.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations.filter((v) => ['serious', 'critical'].includes(v.impact)), 'accessibility: serious/critical axe violations').toEqual([]);
}
export async function accessibility(parity, manifest) { await parity.open(manifest.route); await assertAccessibility(parity); await assertNoSampleData(parity); }
export async function assertRuntimeHealth(parity) {
  // Drain browser tasks and pending event bindings before inspecting the monitor.
  await parity.page.evaluate(() => new Promise((done) => setTimeout(done, 0)));
  expect(parity.faults, `runtime-health: ${parity.faults.join('\n')}`).toEqual([]);
}
export async function runtimeHealth(parity, manifest) { await parity.open(manifest.route); await assertRuntimeHealth(parity); await assertNoSampleData(parity); }
export async function assertResponsive(parity, width) {
  await parity.page.setViewportSize({ width, height: 900 });
  await expect(parity.page.getByRole('main'), `responsive: main at ${width}px`).toBeVisible();
  const sizes = await parity.page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(sizes.scrollWidth, `responsive: horizontal overflow at ${width}px`).toBeLessThanOrEqual(sizes.clientWidth);
}
export async function responsive(parity, manifest) {
  await parity.open(manifest.route);
  for (const width of [375, 768, 1280]) { await assertResponsive(parity, width); await assertNoSampleData(parity); }
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
  await assertNoSampleData(parity);
  await expect(parity.page).toHaveScreenshot('shell.png', { animations: 'disabled', caret: 'hide', scale: 'css', threshold: 0, maxDiffPixels: 0 });
}
export async function kitConformance(manifest) {
  expect(manifest.sources.length, 'kit-conformance: page sources must be declared').toBeGreaterThan(0);
  const result = await runCli(['scripts/lint-colours.mjs', ...manifest.sources]);
  expect(result.status, `kit-conformance: ${result.stderr}`).toBe(0);
}
