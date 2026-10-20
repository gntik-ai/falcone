// This suite is selected only by verify-negatives.mjs. Every case must fail.
import { test, expect } from './harness.mjs';
import manifest from './pages/overview.manifest.ts';
import pageManifest from './fixtures/page.ts';
import * as check from './checks.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const seedText = async (page, text, attribute) => page.evaluate(({ text, attribute }) => {
  const node = document.createElement('button');
  if (attribute) { node.setAttribute(attribute, text); node.textContent = 'synthetic-control'; } else node.textContent = text;
  document.querySelector('main').append(node);
}, { text, attribute });

test('unmatched request names method and path', async ({ parity }) => {
  parity.network.registerEndpoints(pageManifest.endpoints);
  await parity.open(manifest.route);
  const result = await parity.page.evaluate(async () => {
    const res = await fetch('/v1/synthetic-unmatched', { method: 'POST' });
    return { status: res.status, body: await res.json() };
  });
  expect(result).toEqual({ status: 404, body: { error_msg: '404 Route Not Found' } });
  // No explicit unmatched assertion: automatic teardown must fail this test.
});
test('external API request is aborted', async ({ parity }) => {
  await parity.page.goto('https://synthetic.invalid/v1/synthetic-external').catch(() => {});
  // Automatic teardown must reject external requests even under /v1/.
});
for (const fault of ['console.error', 'pageerror', 'unhandledrejection', 'securitypolicyviolation', 'React #426']) {
  test(`runtime-health ${fault}`, async ({ parity }) => {
    await parity.open(manifest.route);
    await parity.page.evaluate((fault) => {
      if (fault === 'console.error') console.error('synthetic-console-error');
      if (fault === 'pageerror') setTimeout(() => { throw new Error('synthetic-page-error'); }, 0);
      if (fault === 'unhandledrejection') Promise.reject(new Error('synthetic-rejection'));
      if (fault === 'securitypolicyviolation') document.dispatchEvent(new SecurityPolicyViolationEvent('securitypolicyviolation', { violatedDirective: 'synthetic-directive' }));
      if (fault === 'React #426') console.warn('Minified React error #426');
    }, fault);
    await parity.page.waitForTimeout(50);
    await check.assertRuntimeHealth(parity);
  });
}
test('accessibility serious violation', async ({ parity }) => {
  await parity.open(manifest.route);
  await parity.page.evaluate(() => { const image = document.createElement('img'); image.src = '/favicon.ico'; document.querySelector('main').append(image); });
  await check.assertAccessibility(parity);
});
test('data missing manifest field', async ({ parity }) => {
  await check.data(parity, { ...manifest, data: [{ name: 'synthetic missing field', locator: '#synthetic-missing' }] });
});
for (const field of ['method', 'path', 'body']) {
  test(`action wrong ${field}`, async ({ parity }) => {
    const action = structuredClone(manifest.actions[0]);
    action.expected[field] = field === 'body' ? { refreshToken: 'synthetic-wrong' } : field === 'method' ? 'POST' : '/v1/synthetic-wrong';
    await check.action(parity, { ...manifest, actions: [action] });
  });
}
test('error-empty missing declared state', async ({ parity }) => {
  await check.errorEmpty(parity, { ...manifest, states: [{ fixture: 'workspaces', variant: 'empty', locator: '#synthetic-missing' }] });
});
test('responsive 400px at 375px', async ({ parity }) => {
  await parity.open(manifest.route);
  await parity.page.evaluate(() => { const node = document.createElement('div'); node.style.width = '400px'; node.textContent = 'synthetic-overflow'; document.body.append(node); });
  await check.assertResponsive(parity, 375);
});
test('visual-review one pixel differs', async ({ parity }, info) => {
  await check.visualReview(parity, manifest, info, async () => {
    await parity.page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
      canvas.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;z-index:99999';
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 1, 1); document.body.append(canvas);
    });
  });
});
for (const [name, text, attribute] of [
  ['catalogue', 'This page will be available soon.'], ['raw key', 'overview.missing'], ['kit copy', 'Search...'],
  ['accessible name', 'User menu', 'aria-label'], ['title', 'User menu', 'title'], ['placeholder', 'User menu', 'placeholder'],
]) test(`locale ${name}`, async ({ parity }) => {
  await parity.open(manifest.route);
  await seedText(parity.page, text, attribute);
  await check.assertLocale(parity);
});
test('kit-conformance raw colour', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'parity-colour-'));
  try {
    const file = join(dir, 'page.tsx'); await writeFile(file, '<div className="text-red-500" />');
    await check.kitConformance({ sources: [file] });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
