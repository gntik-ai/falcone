import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest from './console-profile-page.manifest.ts';
import { profileSession } from '../fixtures/consoleProfile.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';

const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale,
  JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-profile-page.json`, import.meta.url), 'utf8')),
]));
const build = JSON.parse(readFileSync(new URL('../../../dist/.vite/manifest.json', import.meta.url), 'utf8'));
const entry = Object.values(build).find((chunk) => chunk.isEntry && chunk.name === 'app').file;
const surface = (parity) => parity.page.locator('.console-profile');
const copy = (parity) => bundles[parity.locale];
const variants = (variant) => ({ tenant: variant, tenants: variant, workspaces: variant });

async function withSession(parity, variant, navigate) {
  // Seed after the harness bootstrap and before the entry module executes.
  // This works for deep links without depending on addInitScript ordering.
  const seed = async (route) => {
    await parity.page.evaluate((session) => sessionStorage.setItem('in-falcone.console-shell-session', JSON.stringify(session)), profileSession(variant));
    await route.fallback();
  };
  await parity.page.route(`**/${entry}`, seed);
  try { await navigate(); } finally { await parity.page.unroute(`**/${entry}`, seed); }
}
async function open(parity, variant = 'populated', responses = {}) {
  await withSession(parity, variant, () => parity.open(manifest.route, responses));
  await expect(surface(parity).getByRole('heading', { name: copy(parity).title, level: 1 })).toBeVisible();
  await expect(surface(parity).locator('[aria-busy="true"]')).toHaveCount(0);
}
async function noPageRequests(parity) {
  for (const request of parity.network.requests) {
    expect(request.method).toBe('GET');
    expect(new URL(request.path, 'http://synthetic.test').pathname).toMatch(/^\/v1\/(tenants(?:\/synthetic-tenant)?|workspaces)$/);
    expect(request.body).toBeUndefined();
  }
}
async function selectSection(parity, id) {
  const { page } = parity, labels = copy(parity);
  const link = page.getByRole('link', { name: labels.nav[id], exact: true });
  if (await link.isVisible()) await link.click();
  else {
    await page.getByRole('combobox', { name: labels.nav.label, exact: true }).click();
    await page.getByRole('option', { name: labels.nav[id], exact: true }).click();
  }
}
async function assertProfileLocale(parity) {
  await expect(parity.page.locator('html')).toHaveAttribute('lang', parity.locale);
  // Empty shell context has a known WorkspaceSwitcher English-copy gap.
  // Check all profile text and accessible names even in those context states.
  const flatten = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => typeof value === 'string' ? [[prefix + key, value]] : flatten(value, `${prefix}${key}.`));
  const current = new Map(flatten(copy(parity)));
  const foreign = new Set(flatten(bundles[parity.locale === 'es' ? 'en' : 'es']).filter(([key, value]) => value !== current.get(key)).map(([, value]) => value));
  const values = await surface(parity).evaluate((root) => [...root.querySelectorAll('*')].flatMap((node) => {
    if (!node.getClientRects().length) return [];
    return [node.textContent, ...['aria-label', 'title', 'placeholder'].map((name) => node.getAttribute(name))].filter(Boolean);
  }));
  expect(values.filter((value) => foreign.has(value))).toEqual([]);
  expect(values.some((value) => /pages\.console-profile-page\./.test(value))).toBe(false);
}

for (const role of manifest.roles) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-profile-page | ${role} | ${locale} | ${width}`, () => {
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test('data', async ({ parity }) => {
      await open(parity);
      for (const field of manifest.data) await expect(parity.page.locator(typeof field.locator === 'string' ? field.locator : field.locator[locale])).toBeVisible();
      await expect(surface(parity).getByText(copy(parity).roles.labels.tenant_admin, { exact: true })).toBeVisible();
      const profile = surface(parity);
      await expect(profile.locator('dd').filter({ hasText: 'synthetic-user' })).toBeVisible();
      await expect(profile.locator('dd').filter({ hasText: 'synthetic@example.test' })).toBeVisible();
      await expect(profile.locator('input:not([aria-hidden="true"]), textarea, [type="submit"]')).toHaveCount(0);
      await expect(profile.getByRole('button', { name: /Save|Guardar|Discard|Descartar|Edit|Editar/ })).toHaveCount(0);
      await check.assertLocale(parity);
      await noPageRequests(parity);
    });
    test('action', async ({ parity }) => {
      await open(parity);
      await parity.page.evaluate(() => { window.__profileDocument = true; });
      const tenant = parity.page.getByRole('region', { name: locale === 'es' ? 'Contexto activo' : 'Active context', exact: true }).getByRole('combobox');
      await tenant.selectOption('');
      await expect(surface(parity).getByText(copy(parity).missingContext, { exact: true })).toHaveCount(2);
      await tenant.selectOption('synthetic-tenant');
      await expect(surface(parity).getByText('Synthetic Workspace', { exact: true })).toBeVisible();
      await selectSection(parity, 'settings');
      await expect(parity.page).toHaveURL(/\/console\/settings$/);
      // The anchor is migrated by ShellLink; the existing settings select still
      // follows the legacy handoff, as required by this page's scope boundary.
      if (width === 1280) {
        await parity.page.getByRole('link', { name: copy(parity).nav.profile, exact: true }).click();
      } else {
        await parity.page.evaluate((route) => {
          history.pushState(null, '', route); dispatchEvent(new PopStateEvent('popstate'));
        }, new URL(parity.page.url()).pathname.replace(/settings$/, 'profile'));
      }
      await expect(surface(parity)).toBeVisible();
      expect(await parity.page.evaluate(() => window.__profileDocument)).toBe(true);
      await check.assertRuntimeHealth(parity);
      await noPageRequests(parity);
    });
    test('error-empty', async ({ parity, server }) => {
      await open(parity, 'empty', variants('empty'));
      await expect(surface(parity).getByText(copy(parity).missingIdentity, { exact: true })).toHaveCount(2);
      await expect(surface(parity).getByText(copy(parity).missingContext, { exact: true })).toHaveCount(2);
      await expect(surface(parity).getByText(copy(parity).roles.labels.none, { exact: true })).toBeVisible();
      const roles = surface(parity).getByRole('region', { name: copy(parity).roles.title });
      await expect(roles.getByRole('heading', { name: copy(parity).roles.emptyTitle })).toBeVisible();
      await expect(roles.getByRole('button')).toHaveCount(0);
      await assertProfileLocale(parity);
      for (const state of manifest.states) {
        await open(parity, 'populated', { [state.fixture]: state.variant });
        await expect(parity.page.locator(state.locator[locale])).toBeVisible();
        await expect(surface(parity).getByText('tenant_admin', { exact: true })).toBeVisible();
        await expect(surface(parity).getByRole('heading', { name: 'Synthetic Operator' })).toBeVisible();
        await expect(surface(parity).getByText('Synthetic Tenant', { exact: true })).toHaveCount(0);
        await expect(surface(parity).getByText('Synthetic Workspace', { exact: true })).toHaveCount(0);
        await expect(surface(parity).getByRole('button', { name: /Reintentar|Retry|Request access|Solicitar acceso/ })).toHaveCount(0);
        await expect(surface(parity)).not.toContainText('req_8f2c41d07a9b');
        await assertProfileLocale(parity);
        if (['403', '404'].includes(state.variant)) {
          const back = surface(parity).getByRole('link', { name: copy(parity).context.back });
          await expect(back).toHaveAttribute('href', '/console');
          // The root console belongs to the legacy app outside the /next server.
          const legacy = (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><title>Console</title></head><body><main></main></body></html>' });
          await parity.page.route('**/console', legacy);
          const exitStart = parity.faults.length;
          await surface(parity).getByRole('link', { name: copy(parity).context.back }).click();
          await expect(parity.page).toHaveURL(/\/console\/?$/);
          await check.assertRuntimeHealth({ ...parity, faults: parity.faults.slice(exitStart) });
          await parity.page.unroute('**/console', legacy);
        }
      }
      parity.network.setVariants({});
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      const hold = async (route) => { await held; await route.fallback(); };
      await parity.page.route('**/v1/workspaces**', hold);
      try {
        await withSession(parity, 'populated', () => parity.page.goto(server.url('console/profile')));
        await expect(surface(parity).getByText(copy(parity).loading.identity, { exact: true })).toBeVisible();
        await expect(surface(parity).getByText(copy(parity).loading.roles, { exact: true })).toBeVisible();
        await expect(surface(parity).getByText('tenant_admin', { exact: true })).toHaveCount(0);
        await expect(surface(parity).getByText('synthetic@example.test', { exact: true })).toHaveCount(0);
      } finally { release(); await parity.page.unroute('**/v1/workspaces**', hold); }
      await expect(surface(parity).getByText('tenant_admin', { exact: true })).toBeVisible();
      await expect(surface(parity).locator('[aria-busy="true"]')).toHaveCount(0);
      await noPageRequests(parity);
    });
    test('accessibility', async ({ parity }) => {
      for (const state of ['populated', 'empty', '403', '404', '500', 'network']) {
        await open(parity, state === 'empty' ? 'empty' : 'populated', state === 'empty' ? variants('empty') : state === 'populated' ? {} : { workspaces: state });
        await check.assertAccessibility(parity);
        await assertProfileLocale(parity);
        const headings = await surface(parity).locator('h1, h2, h3').evaluateAll((items) => items.map((node) => node.tagName));
        expect(headings[0]).toBe('H1');
        const terms = surface(parity).locator('dt');
        expect(await terms.count()).toBe(await surface(parity).locator('dd').count());
        if (width === 1280) {
          const current = surface(parity).getByRole('link', { name: copy(parity).nav.profile, exact: true });
          await expect(current).toHaveAttribute('aria-current', 'page');
          await current.focus(); await expect(current).toBeFocused();
        } else {
          const nav = surface(parity).getByRole('combobox', { name: copy(parity).nav.label });
          await nav.focus(); await expect(nav).toBeFocused();
        }
        const back = surface(parity).getByRole('link', { name: copy(parity).context.back });
        if (await back.count()) { await back.focus(); await expect(back).toBeFocused(); }
      }
    });
    test('runtime-health', async ({ parity, server }) => {
      await open(parity);
      await selectSection(parity, 'settings');
      await expect(parity.page).toHaveURL(/\/console\/settings$/);
      await parity.page.evaluate((route) => {
        history.pushState(null, '', route); dispatchEvent(new PopStateEvent('popstate'));
      }, new URL(server.url('console/profile')).pathname);
      await expect(surface(parity)).toBeVisible();
      await check.assertRuntimeHealth(parity);
      expect(build['src/pages/consoleProfile.tsx'].isDynamicEntry).toBe(true);
      expect(build['src/pages/consoleProfile.tsx'].file).not.toBe(entry);
      await noPageRequests(parity);
    });
    test('responsive', async ({ parity }) => {
      await open(parity, 'long-email');
      await check.assertResponsive(parity, width);
      const nav = surface(parity).getByRole('combobox', { name: copy(parity).nav.label });
      if (width < 1024) {
        await expect(nav).toBeVisible();
        expect((await nav.boundingBox()).y).toBeLessThan((await surface(parity).locator('h1').boundingBox()).y);
      } else await expect(nav).toBeHidden();
      if (width < 640) {
        const list = surface(parity).locator('dl').first().locator('..');
        expect(await list.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(1);
      }
      await expect(surface(parity).locator('dd').filter({ hasText: profileSession('long-email').principal.primaryEmail })).toBeVisible();
    });
    test('visual-review', async ({ parity }, info) => {
      for (const state of ['populated', 'no-roles-no-context', '403', '404', '500']) {
        const empty = state === 'no-roles-no-context';
        await open(parity, empty ? 'empty' : 'populated', empty ? variants('empty') : state === 'populated' ? {} : { workspaces: state });
        await assertProfileLocale(parity);
        const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
        const hash = createHash('sha256').update(body).digest('hex');
        await info.attach(`${state}-${locale}-${width}-sha256-${hash}`, { body, contentType: 'image/png' });
      }
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
    test('expired deep link redirects to login with the basename-qualified intent', async ({ parity, server }) => {
      parity.network.setVariants({ refresh: '401' });
      const url = server.url('console/profile');
      await withSession(parity, 'expired', () => parity.page.goto(url));
      await expect(parity.page).toHaveURL(/\/login$/);
      await expect.poll(() => parity.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(new URL(url).pathname);
    });
  });
}
