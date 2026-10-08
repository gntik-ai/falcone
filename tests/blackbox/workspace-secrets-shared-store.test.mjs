import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('function routes and lifecycle handlers share one Kubernetes-auth provider', () => {
  const source = `
    import assert from 'node:assert/strict';
    import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    const dir = mkdtempSync(join(tmpdir(), 'falcone-977-'));
    try {
      const jwtPath = join(dir, 'jwt');
      writeFileSync(jwtPath, 'synthetic-jwt');
      Object.assign(process.env, {
        BAO_ADDR: 'http://synthetic-bao', BAO_TOKEN: '',
        BAO_KUBERNETES_AUTH_ROLE: 'synthetic-role', BAO_KUBERNETES_AUTH_MOUNT: 'kubernetes',
        BAO_SERVICEACCOUNT_JWT_PATH: jwtPath,
      });
      let logins = 0;
      globalThis.fetch = async (url) => {
        if (url.endsWith('/login')) {
          logins++;
          return { ok: true, json: async () => ({ auth: {
            client_token: 'synthetic-token', lease_duration: 3600, renewable: false,
          } }) };
        }
        return { ok: false, status: 404 };
      };
      const { secretBackendHealth } = await import('./apps/control-plane/fn-handlers.mjs');
      await import('./apps/control-plane/b-handlers.mjs');
      const { getSharedVaultStore } = await import('./apps/control-plane/vault-secrets.mjs');
      const shared = getSharedVaultStore();
      await new Promise(setImmediate);
      assert.equal(logins, 1);
      assert.equal(getSharedVaultStore(), shared);
      assert.deepEqual(secretBackendHealth(), shared.getHealthSnapshot());
    } finally { rmSync(dir, { recursive: true, force: true }); }
  `;
  const result = spawnSync(process.execPath, [...process.execArgv.filter((arg) => arg !== '--test'), '--input-type=module', '-e', source], {
    cwd: new URL('../..', import.meta.url), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
});
