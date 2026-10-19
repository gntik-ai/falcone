import { expect } from '@playwright/test';
import { test } from './harness.mjs';
import { endpoints, variants } from './fixtures/shell.ts';

for (const role of ['superadmin', 'tenant_owner', 'tenant_viewer']) {
  test.describe(`endpoint fixtures ${role}`, () => {
    test.use({ role });
    for (const [name, endpoint] of Object.entries(endpoints)) for (const variant of variants) {
      test(`${name} ${variant}`, async ({ parity }) => {
        await parity.open('/console/overview');
        parity.network.setVariants({ [name]: variant });
        const result = await parity.page.evaluate(async ({ method, path }) => {
          try {
            const response = await fetch(path, { method });
            return { status: response.status, body: await response.json() };
          } catch { return { failure: true }; }
        }, endpoint);
        if (variant === 'network') expect(result).toEqual({ failure: true });
        else {
          expect(result.status).toBe(['success', 'empty'].includes(variant) ? 200 : Number(variant));
          if (variant === 'empty' && ['tenants', 'workspaces'].includes(name)) expect(result.body.items).toEqual([]);
          if (variant === 'success' && name === 'refresh') expect(result.body.principal.platformRoles).toEqual([role]);
        }
      });
    }
  });
}
