// Copy this eight-check template alongside each new page manifest.
import manifest from './overview.manifest.ts';
import { test } from '../harness.mjs';
import * as check from '../checks.mjs';

for (const role of manifest.roles) for (const locale of ['es', 'en']) {
  test.describe(`overview | ${role} | ${locale}`, () => {
    test.use({ role, locale });
    test('data', async ({ parity }) => { await check.data(parity, manifest); });
    test('action', async ({ parity }) => { await check.action(parity, manifest); });
    test('error-empty', async ({ parity }) => { await check.errorEmpty(parity, manifest); });
    test('accessibility', async ({ parity }) => { await check.accessibility(parity, manifest); });
    test('runtime-health', async ({ parity }) => { await check.runtimeHealth(parity, manifest); });
    test('responsive', async ({ parity }) => { await check.responsive(parity, manifest); });
    test('visual-review', async ({ parity }, info) => { await check.visualReview(parity, manifest, info); });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
  });
}
