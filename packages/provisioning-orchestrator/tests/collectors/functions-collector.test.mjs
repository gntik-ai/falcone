import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

describe('functions-collector', () => {
  const origOWEnabled = process.env.CONFIG_EXPORT_OW_ENABLED;
  const origOWHost = process.env.CONFIG_EXPORT_OW_API_HOST;
  const origOWToken = process.env.CONFIG_EXPORT_OW_AUTH_TOKEN;

  afterEach(() => {
    if (origOWEnabled !== undefined) process.env.CONFIG_EXPORT_OW_ENABLED = origOWEnabled;
    else delete process.env.CONFIG_EXPORT_OW_ENABLED;
    if (origOWHost !== undefined) process.env.CONFIG_EXPORT_OW_API_HOST = origOWHost;
    else delete process.env.CONFIG_EXPORT_OW_API_HOST;
    if (origOWToken !== undefined) process.env.CONFIG_EXPORT_OW_AUTH_TOKEN = origOWToken;
    else delete process.env.CONFIG_EXPORT_OW_AUTH_TOKEN;
  });

  it('returns not_available when CONFIG_EXPORT_OW_ENABLED is not true', async () => {
    delete process.env.CONFIG_EXPORT_OW_ENABLED;
    const { collect } = await import('../../src/collectors/functions-collector.mjs');
    const result = await collect('tenant-a');
    assert.equal(result.status, 'not_available');
    assert.equal(result.domain_key, 'functions');
  });

  it('redacts parameters with encrypt: true', async () => {
    process.env.CONFIG_EXPORT_OW_ENABLED = 'true';
    process.env.CONFIG_EXPORT_OW_API_HOST = 'http://ow:3233';
    process.env.CONFIG_EXPORT_OW_AUTH_TOKEN = 'test:token';

    const { collect } = await import('../../src/collectors/functions-collector.mjs');

    const fetchFn = async (url) => {
      if (url.endsWith('/actions')) return { ok: true, json: async () => [{ name: 'myFunc' }] };
      if (url.includes('/actions/myFunc')) return {
        ok: true,
        json: async () => ({
          name: 'myFunc',
          namespace: 'tenant-a',
          exec: { kind: 'nodejs:18', code: 'console.log("hello")' },
          limits: {},
          parameters: [
            { key: 'API_KEY', value: 'secret-123', encrypt: true },
            { key: 'REGION', value: 'us-east-1' },
          ],
          annotations: [],
        }),
      };
      if (url.endsWith('/packages')) return { ok: true, json: async () => [] };
      if (url.endsWith('/triggers')) return { ok: true, json: async () => [] };
      if (url.endsWith('/rules')) return { ok: true, json: async () => [] };
      return { ok: false, status: 404 };
    };

    const result = await collect('tenant-a', { fetchFn });
    assert.equal(result.status, 'ok');
    const secret = result.data.actions[0].parameters.find(p => p.key === 'API_KEY');
    assert.equal(secret.value, '***REDACTED***');
    const region = result.data.actions[0].parameters.find(p => p.key === 'REGION');
    assert.equal(region.value, 'us-east-1');
  });

  it('includes action code as base64', async () => {
    process.env.CONFIG_EXPORT_OW_ENABLED = 'true';
    process.env.CONFIG_EXPORT_OW_API_HOST = 'http://ow:3233';
    process.env.CONFIG_EXPORT_OW_AUTH_TOKEN = 'test:token';

    const { collect } = await import('../../src/collectors/functions-collector.mjs');
    const code = 'function main() { return {}; }';

    const fetchFn = async (url) => {
      if (url.endsWith('/actions')) return { ok: true, json: async () => [{ name: 'fn1' }] };
      if (url.includes('/actions/fn1')) return {
        ok: true,
        json: async () => ({ name: 'fn1', namespace: 'tenant-a', exec: { kind: 'nodejs:18', code }, limits: {}, parameters: [], annotations: [] }),
      };
      if (url.endsWith('/packages') || url.endsWith('/triggers') || url.endsWith('/rules')) return { ok: true, json: async () => [] };
      return { ok: false, status: 404 };
    };

    const result = await collect('tenant-a', { fetchFn });
    assert.equal(result.data.actions[0].code_available, true);
    assert.equal(Buffer.from(result.data.actions[0].code_base64, 'base64').toString(), code);
  });

  it('handles code_available: false for non-inline actions', async () => {
    process.env.CONFIG_EXPORT_OW_ENABLED = 'true';
    process.env.CONFIG_EXPORT_OW_API_HOST = 'http://ow:3233';
    process.env.CONFIG_EXPORT_OW_AUTH_TOKEN = 'test:token';

    const { collect } = await import('../../src/collectors/functions-collector.mjs');

    const fetchFn = async (url) => {
      if (url.endsWith('/actions')) return { ok: true, json: async () => [{ name: 'zipFn' }] };
      if (url.includes('/actions/zipFn')) return {
        ok: true,
        json: async () => ({ name: 'zipFn', namespace: 'tenant-a', exec: { kind: 'nodejs:18', binary: true }, limits: {}, parameters: [], annotations: [] }),
      };
      if (url.endsWith('/packages') || url.endsWith('/triggers') || url.endsWith('/rules')) return { ok: true, json: async () => [] };
      return { ok: false, status: 404 };
    };

    const result = await collect('tenant-a', { fetchFn });
    const action = result.data.actions[0];
    assert.equal(action.code_base64, null);
    assert.equal(action.code_available, false);
  });

  it('returns empty when namespace has no actions or packages', async () => {
    process.env.CONFIG_EXPORT_OW_ENABLED = 'true';
    process.env.CONFIG_EXPORT_OW_API_HOST = 'http://ow:3233';
    process.env.CONFIG_EXPORT_OW_AUTH_TOKEN = 'test:token';

    const { collect } = await import('../../src/collectors/functions-collector.mjs');

    const fetchFn = async (url) => {
      return { ok: true, json: async () => [] };
    };

    const result = await collect('tenant-a', { fetchFn });
    assert.equal(result.status, 'empty');
  });
});
