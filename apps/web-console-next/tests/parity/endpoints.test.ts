import { test } from 'vitest';
import assert from 'node:assert/strict';

const pageEndpoints = {
  records: { method: 'GET', path: '/v1/synthetic-records', fixtures: {
    success: (role: string) => ({ status: 200, body: { items: ['Synthetic record'], role } }),
    empty: { status: 200, body: { items: [] } },
  } },
};

test('page endpoints and fixtures merge with shell endpoints for both workspace roles', async () => {
  const { createEndpointRegistry } = await import('./endpoint-registry');
  for (const role of ['workspace_admin', 'workspace_viewer'] as const) {
    const registry = createEndpointRegistry({ tenants: { method: 'GET', path: '/v1/tenants' } }, () => ({ status: 200, body: { items: ['Tenant'] } }), pageEndpoints);
    assert.equal(registry.find('GET', '/v1/tenants'), 'tenants');
    assert.equal(registry.find('GET', '/v1/synthetic-records'), 'records');
    assert.equal(registry.find('POST', '/v1/synthetic-records'), undefined);
    assert.equal(registry.find('GET', '/v1/unregistered'), undefined);
    assert.deepEqual(registry.responseFor('records', role), { status: 200, body: { items: ['Synthetic record'], role } });
    assert.deepEqual(registry.responseFor('tenants', role), { status: 200, body: { items: ['Tenant'] } });
  }
});

test('page endpoints cannot shadow shell names or method/path pairs', async () => {
  const { createEndpointRegistry } = await import('./endpoint-registry')
  const shell = { tenants: { method: 'GET', path: '/v1/tenants' } }
  const response = () => ({ status: 200 })
  assert.throws(() => createEndpointRegistry(shell, response, { tenants: pageEndpoints.records }), /collision.*tenants/i)
  assert.throws(() => createEndpointRegistry(shell, response, {
    records: { ...pageEndpoints.records, path: '/v1/tenants' },
  }), /collision.*GET \/v1\/tenants/i)
  assert.throws(() => createEndpointRegistry(shell, response, {
    records: pageEndpoints.records, alias: pageEndpoints.records,
  }), /collision.*GET \/v1\/synthetic-records/i)
})

test('responses can be delayed, failed, then succeeded per endpoint and reset between opens', async () => {
  const { createEndpointRegistry } = await import('./endpoint-registry')
  const registry = createEndpointRegistry({ tenants: { method: 'GET', path: '/v1/tenants' } },
    (_name, variant) => ({ status: variant === '403' ? 403 : 200, body: { items: ['Tenant'] } }), pageEndpoints)
  registry.setVariants({ records: [{ variant: '500', delayMs: 100 }, { variant: 'success', delayMs: 25 }], tenants: { variant: '403', delayMs: 50 } })
  assert.deepEqual(registry.responseFor('records', 'workspace_admin'), { status: 500, body: { code: 'HTTP_500', message: 'synthetic-error' }, delayMs: 100 })
  assert.deepEqual(registry.responseFor('tenants', 'workspace_admin'), { status: 403, body: { items: ['Tenant'] }, delayMs: 50 })
  const success = { status: 200, body: { items: ['Synthetic record'], role: 'workspace_admin' }, delayMs: 25 }
  assert.deepEqual(registry.responseFor('records', 'workspace_admin'), success)
  assert.deepEqual(registry.responseFor('records', 'workspace_admin'), success)
  registry.setVariants({ records: ['network', 'empty'] })
  assert.deepEqual(registry.responseFor('records', 'workspace_viewer'), { network: true })
  assert.deepEqual(registry.responseFor('records', 'workspace_viewer'), { status: 200, body: { items: [] } })
  registry.setVariants({})
  assert.deepEqual(registry.responseFor('records', 'workspace_viewer'), { status: 200, body: { items: ['Synthetic record'], role: 'workspace_viewer' } })
  assert.throws(() => registry.setVariants({ typo: 'success' }), /Unknown endpoint.*typo/)
  registry.setVariants({ records: 'typo' })
  assert.throws(() => registry.responseFor('records', 'workspace_viewer'), /Unknown fixture.*records.*typo/)
})
