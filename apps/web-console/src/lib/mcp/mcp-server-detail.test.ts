import { describe, expect, it } from 'vitest'

import { buildPlaygroundToolCall, toMcpServerDetailViewModel } from './mcp-server-detail'

describe('toMcpServerDetailViewModel', () => {
  it('surfaces endpoint, active version, source and the curated tool list', () => {
    const view = toMcpServerDetailViewModel({
      id: 'srv_1',
      name: 'Acme Orders',
      slug: 'acme-orders',
      status: 'running',
      endpointUrl: 'https://gw.example.test/mcp/acme-orders',
      activeVersion: {
        version: 'v3',
        source: 'instant',
        tools: [
          { name: 'list_orders', description: 'list', mutates: false, scope: null },
          { name: 'create_order', description: 'create', mutates: true, suggestedScope: 'mcp:orders:write' }
        ]
      }
    })
    expect(view.endpoint).toBe('https://gw.example.test/mcp/acme-orders')
    expect(view.version).toBe('v3')
    expect(view.source).toBe('instant')
    expect(view.transport).toBe('streamable-http')
    expect(view.tools).toEqual([
      { name: 'list_orders', description: 'list', mutates: false, scope: null },
      { name: 'create_order', description: 'create', mutates: true, scope: 'mcp:orders:write' }
    ])
  })

  it('tolerates a missing endpoint / version (null, no throw)', () => {
    const view = toMcpServerDetailViewModel({ name: 'Acme' })
    expect(view.endpoint).toBeNull()
    expect(view.version).toBeNull()
    expect(view.tools).toEqual([])
  })
})

describe('buildPlaygroundToolCall', () => {
  const base = { endpoint: 'https://gw.example.test/mcp/acme', toolName: 'list_orders', accessToken: 'tok_abc' }

  it('builds an authenticated JSON-RPC tools/call carrying the OAuth bearer token', () => {
    const call = buildPlaygroundToolCall({ ...base, args: { limit: 5 } })
    expect(call.method).toBe('POST')
    expect(call.url).toBe(base.endpoint)
    expect(call.headers.Authorization).toBe('Bearer tok_abc')
    expect(call.headers['MCP-Protocol-Version']).toBe('2025-11-25')
    expect(call.body).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'list_orders', arguments: { limit: 5 } }
    })
  })

  it('refuses to build a call without an OAuth access token', () => {
    expect(() => buildPlaygroundToolCall({ ...base, accessToken: null })).toThrow(/OAuth access token/)
  })

  it('refuses to build a call when the endpoint is not yet available', () => {
    expect(() => buildPlaygroundToolCall({ ...base, endpoint: null })).toThrow(/endpoint/)
  })
})
