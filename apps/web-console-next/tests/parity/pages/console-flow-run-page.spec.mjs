import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { cancelPath, eventsPath, executionPath, executionVariants, flowPath, retryPath, signalPath, sse, runRoute } from './console-flow-run-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';

const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale,
  JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-flow-run-page.json`, import.meta.url), 'utf8')),
]));
const streams = new WeakMap();
const copy = (parity) => bundles[parity.locale];
const surface = (parity) => parity.page.getByTestId('console-flow-run-page');
const node = (parity, id) => parity.page.locator(`.react-flow__node[data-id="${id}"]`);
const heading = (parity, key) => parity.page.getByRole('heading', { name: copy(parity)[key], exact: true });
const runCalls = (parity) => parity.network.requests.filter((request) => request.path.startsWith('/v1/flows/workspaces/synthetic-workspace/'));
const eventCalls = (parity) => parity.network.requests.filter((request) => request.path.startsWith(eventsPath));
// The events stream is served by this page journey: it needs the session bearer and no query string.
async function open(parity, execution = 'completed', { stream = 'frames', variants = {} } = {}) {
  let release;
  streams.set(parity, { mode: stream, connections: 0, lastEventIds: [], authorizations: [], release: new Promise((resolve) => { release = resolve; }), resume: release });
  await parity.open(manifest.route, { 'flows.run.execution': execution, ...variants });
}
async function screenshot(parity, info, name) {
  await check.assertLocale(parity);
  const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
  await info.attach(`${name}-${parity.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}
async function select(parity, id) { await node(parity, id).focus(); await parity.page.keyboard.press('Enter'); await expect(parity.page.locator('#run-inspector-heading')).toBeFocused(); }

for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`Flow run ${locale} ${width}`, () => {
    test.use({ role: 'superadmin', locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test.beforeEach(async ({ parity }) => {
      const injected = [];
      // The retry journey lands on the new execution, a terminal run served here.
      await parity.page.route((url) => url.pathname === executionPath.replace('/e1', '/e2'), async (route) => {
        parity.network.requests.push({ method: 'GET', path: new URL(route.request().url()).pathname, body: undefined });
        await route.fulfill({ json: { ...executionVariants.completed, executionId: 'e2' } });
      });
      await parity.page.route((url) => url.pathname === eventsPath, async (route) => {
        const request = route.request(), url = new URL(request.url());
        parity.network.requests.push({ method: request.method(), path: url.pathname + url.search, body: undefined });
        const state = streams.get(parity) ?? { mode: 'frames', connections: 0, lastEventIds: [], authorizations: [], release: Promise.resolve() };
        const headers = request.headers();
        state.authorizations.push(headers.authorization); state.lastEventIds.push(headers['last-event-id']);
        const attempt = state.connections++;
        if (request.method() !== 'GET' || url.search || /apikey/i.test(url.href) || !/^Bearer\s+\S+$/i.test(headers.authorization ?? '')) {
          parity.faults.push(`Unmatched events request ${request.method()} ${url.pathname}${url.search}`);
          await route.abort(); return;
        }
        if (state.mode === 'error') {
          injected.push({ url: request.url(), kind: '403' });
          await route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }); return;
        }
        let body = sse.nodeStatusFrames;
        if (state.mode === 'drop') {
          if (attempt === 0) body = sse.dropFirst;
          else { await state.release; body = sse.resumed; }
        }
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
      });
      parity.page.on('console', (message) => {
        if (message.type() !== 'error' || !consumeResourceDiagnostic(message.text(), message.location().url, injected)) return;
        const index = parity.faults.indexOf(`console.error: ${message.text()}`);
        if (index >= 0) parity.faults.splice(index, 1);
      });
    });
    test.describe(`console-flow-run-page | superadmin | ${locale} | ${width}`, () => {
    test('data', async ({ parity }) => {
      await open(parity, 'completed');
      await expect(parity.page.getByRole('heading', { name: 'Synthetic flow', level: 1 })).toBeVisible();
      await expect(parity.page.getByTestId('run-static-indicator')).toHaveText(copy(parity).staticIndicator);
      await expect(node(parity, 'start')).toContainText(copy(parity).nodeStatus.completed);
      expect(eventCalls(parity)).toHaveLength(0);
      await node(parity, 'start').click();
      await expect(parity.page.getByRole('region', { name: copy(parity).input, exact: true })).toContainText('synthetic');
      await expect(parity.page.getByRole('region', { name: copy(parity).output, exact: true })).toContainText('synthetic');
      await expect(parity.page.getByTestId('run-node-attempts').getByRole('listitem')).toHaveCount(2);
      // The cap: 4095 and 4096 render whole; 4097 is cut to 4096 characters plus an ellipsis with its badge.
      for (const [variant, cut] of [['payload-4095', false], ['payload-4096', false], ['payload-4097', true]]) {
        await open(parity, variant); await node(parity, 'start').click();
        const output = parity.page.getByTestId('run-node-payload-salida');
        const text = (await output.locator('[data-line]').allTextContents()).join('\n');
        expect(text.length).toBe(cut ? 4097 : Number(variant.slice(-4)));
        if (cut) { expect(text.endsWith('…')).toBe(true); await expect(parity.page.getByTestId('run-node-salida-truncated')).toHaveText(copy(parity).truncated); }
        else await expect(parity.page.getByTestId('run-node-salida-truncated')).toHaveCount(0);
        await expect(parity.page.getByTestId('run-node-entrada-truncated')).toHaveCount(0);
      }
      await open(parity, 'payload-string-and-null'); await node(parity, 'start').click();
      await expect(parity.page.getByRole('region', { name: copy(parity).input, exact: true })).toHaveText(/plain synthetic text/);
      await expect(parity.page.getByTestId('run-node-salida-empty')).toHaveText(/—/);
      // A running run streams with no key entered and its frames update the statuses.
      await open(parity, 'running');
      await expect(node(parity, 'review')).toContainText(copy(parity).nodeStatus.completed);
      await expect(parity.page.getByRole('textbox')).toHaveCount(0);
      await check.assertLocale(parity);
    });
    test('action', async ({ parity }) => {
      await open(parity, 'running', { variants: { 'flows.run.cancellations': 'success' } });
      await expect(node(parity, 'review')).toContainText(copy(parity).nodeStatus.completed);
      await parity.page.getByTestId('run-cancel-button').click();
      await parity.page.getByTestId('confirm-action-confirm').click();
      await expect.poll(() => runCalls(parity).filter(({ method, path }) => method === 'POST' && path === cancelPath)).toHaveLength(1);
      expect(runCalls(parity).find(({ path }) => path === cancelPath).body).toBeUndefined();
      await expect(parity.page.getByRole('region', { name: copy(parity).notifications }).getByText(copy(parity).cancelledResult)).toBeVisible();
      await open(parity, 'failed', { variants: { 'flows.run.retries': 'success' } });
      await parity.page.getByTestId('run-retry-button').click(); await parity.page.getByTestId('confirm-action-confirm').click();
      await expect(parity.page).toHaveURL(/\/console\/flows\/f1\/runs\/e2$/);
      expect(runCalls(parity).some(({ method, path }) => method === 'POST' && path === retryPath)).toBe(true);
      for (const [button, approved] of [['approve', true], ['reject', false]]) {
        await open(parity, 'waiting-approval', { variants: { 'flows.run.signals': 'success' } });
        await parity.page.getByTestId(`run-${button}-button`).click(); await parity.page.getByTestId('confirm-action-confirm').click();
        await expect.poll(() => runCalls(parity).filter(({ method, path }) => method === 'POST' && path === signalPath).length).toBeGreaterThan(0);
        expect(runCalls(parity).filter(({ path }) => path === signalPath).at(-1).body).toEqual({ approved, nodeId: 'review' });
      }
      // Every request: no query credential, and the events request carries the session bearer.
      expect(parity.network.requests.every(({ path }) => !/apikey/i.test(path))).toBe(true);
      const state = streams.get(parity);
      expect(state.authorizations.every((value) => /^Bearer\s+\S+$/.test(value))).toBe(true);
      expect(eventCalls(parity).every(({ path }) => path === eventsPath)).toBe(true);
      // Drop then resume: the live indicator turns off, the node keeps its status and the reconnect resumes.
      await open(parity, 'running', { stream: 'drop' });
      await expect(parity.page.getByTestId('run-stream-notice')).toContainText(copy(parity).reconnectingTitle);
      await expect(parity.page.getByTestId('run-streaming-indicator')).toHaveCount(0);
      await expect(node(parity, 'review')).toContainText(copy(parity).nodeStatus.started);
      streams.get(parity).resume();
      await expect(node(parity, 'review')).toContainText(copy(parity).nodeStatus.completed);
      expect(streams.get(parity).lastEventIds.slice(0, 2)).toEqual([undefined, '1']);
    });
    test('error-empty', async ({ parity }) => {
      for (const [variant, key] of [['403', 'noAccess'], ['404', 'notFound'], ['500', 'errorTitle'], ['network', 'errorTitle']]) {
        await open(parity, variant); await expect(heading(parity, key)).toBeVisible();
        if (variant === '403') { await expect(parity.page.getByText('synthetic-backend-reason')).toBeVisible(); await expect(parity.page.getByRole('button', { name: /Request access|Solicitar acceso/ })).toHaveCount(0); }
        if (variant === '404') await expect(parity.page.getByRole('link', { name: copy(parity).backToRuns, exact: true })).toHaveAttribute('href', '/console/flows/f1/runs');
        if (variant === '500') await expect(parity.page.getByText('req_synthetic_run', { exact: true })).toBeVisible();
      }
      await open(parity, 'completed', { variants: { 'flows.run.flow': 'no-definition' } });
      await expect(heading(parity, 'noDefinition')).toBeVisible();
      await expect(parity.page.getByTestId('run-action-toolbar')).toHaveCount(0);
      await open(parity, 'payload-string-and-null'); await node(parity, 'start').click();
      await expect(parity.page.getByTestId('run-node-attempts').getByText(copy(parity).noAttempts)).toBeVisible();
      await open(parity, 'running', { variants: { 'flows.run.cancellations': '403' } });
      await parity.page.getByTestId('run-cancel-button').click(); await parity.page.getByTestId('confirm-action-confirm').click();
      await expect(parity.page.getByTestId('run-action-error')).toContainText('synthetic-backend-reason');
      await expect(node(parity, 'start')).toBeVisible();
      await open(parity, 'running', { stream: 'error' });
      await expect(parity.page.getByTestId('run-stream-notice')).toContainText(copy(parity).unavailableTitle);
      const before = runCalls(parity).length;
      await parity.open(manifest.route, { workspaces: 'empty' });
      await expect(heading(parity, 'blocked')).toBeVisible();
      await parity.page.waitForTimeout(50); expect(runCalls(parity)).toHaveLength(before);
    });
    test('accessibility', async ({ parity }) => {
      await open(parity, 'payload-4097');
      await expect(node(parity, 'start')).toHaveAccessibleName(new RegExp(copy(parity).nodeStatus.completed));
      await expect(parity.page.getByTestId('rf__controls')).toHaveAttribute('aria-label', copy(parity).controls.ariaLabel);
      await select(parity, 'start');
      await expect(parity.page.getByRole('region', { name: copy(parity).payloadTruncated.replace('{name}', copy(parity).output), exact: true })).toBeVisible();
      await check.assertAccessibility(parity); await check.assertLocale(parity);
      await parity.page.keyboard.press('Escape'); await expect(node(parity, 'start')).toBeFocused();
      await node(parity, 'review').focus(); await parity.page.keyboard.press('Space');
      await expect(parity.page.locator('#run-inspector-heading')).toBeFocused();
      await parity.page.getByTestId('run-node-detail-close').click(); await expect(node(parity, 'review')).toBeFocused();
      await open(parity, 'waiting-approval');
      const approve = parity.page.getByTestId('run-approve-button'); await approve.click();
      await parity.page.getByTestId('confirm-action-cancel').click(); await expect(approve).toBeFocused();
      await check.assertAccessibility(parity);
    });
    test('runtime-health', async ({ parity }) => {
      await open(parity, 'running');
      await expect(node(parity, 'review')).toContainText(copy(parity).nodeStatus.completed);
      await parity.page.getByRole('link', { name: copy(parity).runs, exact: true }).first().click();
      await check.assertRuntimeHealth(parity);
      expect(parity.network.requests.every(({ path }) => !/apikey/i.test(path))).toBe(true);
    });
    test('responsive', async ({ parity }) => {
      await open(parity, 'payload-4097'); await check.assertResponsive(parity, width);
      await node(parity, 'start').click();
      await expect(parity.page.locator('#run-inspector-heading')).toBeVisible(); await check.assertResponsive(parity, width);
      await expect(parity.page.getByTestId('run-action-toolbar')).toBeVisible();
      if (width === 1280) await expect(surface(parity).getByRole('complementary', { name: copy(parity).inspector })).toBeVisible();
    });
    test('kit-conformance', async ({ parity }) => {
      await check.kitConformance(manifest); await open(parity, 'payload-4097'); await node(parity, 'start').click();
      await expect(parity.page.getByTestId('run-node-salida-truncated')).toBeVisible(); await check.assertLocale(parity);
    });
    test('visual-review', async ({ parity }, info) => {
      for (const variant of ['completed', 'running', 'waiting-approval', 'failed']) {
        await open(parity, variant); await select(parity, variant === 'failed' ? 'done' : 'review'); await screenshot(parity, info, variant);
      }
      await open(parity, 'payload-4097'); await select(parity, 'start'); await screenshot(parity, info, 'payload-4097');
      await open(parity, 'completed', { variants: { 'flows.run.flow': 'no-definition' } }); await expect(heading(parity, 'noDefinition')).toBeVisible(); await screenshot(parity, info, 'no-definition');
      await open(parity, '403'); await expect(heading(parity, 'noAccess')).toBeVisible(); await screenshot(parity, info, '403');
      await open(parity, '500'); await expect(heading(parity, 'errorTitle')).toBeVisible(); await screenshot(parity, info, '500');
      // The checker and operator assess these artifacts; the maker cannot approve baselines.
    });
    });
    for (const variant of ['401-ok', '401-rejected']) test(variant, async ({ parity, server }) => {
      let attempt = 0;
      await parity.page.route((url) => url.pathname === executionPath, async (route) => {
        const request = route.request();
        parity.network.requests.push({ method: 'GET', path: executionPath, body: undefined });
        if (variant === '401-rejected' || attempt++ === 0) { await route.fulfill({ status: 401, json: { code: 'UNAUTHORIZED' } }); return; }
        await route.fulfill({ json: executionVariants.completed });
      });
      await parity.open(manifest.route, variant === '401-rejected' ? { refresh: '401' } : {});
      if (variant === '401-ok') await expect(node(parity, 'start')).toBeVisible();
      else {
        await expect(parity.page).toHaveURL(server.url('login'));
        expect(await parity.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(new URL(server.url(runRoute.slice(1))).pathname);
      }
      expect(parity.network.requests.filter(({ path }) => path.endsWith('/refresh'))).toHaveLength(1);
      expect(parity.network.requests.filter(({ path }) => path === executionPath)).toHaveLength(variant === '401-rejected' ? 1 : 2);
      expect(eventCalls(parity)).toHaveLength(0);
    });
  });
}
