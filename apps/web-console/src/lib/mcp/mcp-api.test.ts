import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/console-session', () => ({
  requestConsoleSessionJson: vi.fn().mockResolvedValue({})
}))

import { requestConsoleSessionJson } from '@/lib/console-session'
import { fetchMcpServerDetail, invokeMcpTool } from './mcp-api'

const requestMock = requestConsoleSessionJson as unknown as ReturnType<typeof vi.fn>
const lastCall = () => requestMock.mock.calls[requestMock.mock.calls.length - 1]

beforeEach(() => {
  requestMock.mockClear()
  requestMock.mockResolvedValue({})
})

describe('mcp-api — workspace-scoped console routes', () => {
  it('fetchMcpServerDetail calls the served workspace-scoped detail route', async () => {
    const signal = new AbortController().signal

    await fetchMcpServerDetail('ws/tenant 1', 'srv/orders 1', signal)

    expect(lastCall()).toEqual([
      '/v1/mcp/workspaces/ws%2Ftenant%201/servers/srv%2Forders%201',
      { signal }
    ])
  })

  it('invokeMcpTool calls the served workspace-scoped tool-calls route', async () => {
    await invokeMcpTool('ws_1', 'srv_1', 'list_orders', { limit: 5 })

    expect(lastCall()).toEqual([
      '/v1/mcp/workspaces/ws_1/servers/srv_1/tool-calls',
      { method: 'POST', body: { name: 'list_orders', arguments: { limit: 5 } }, signal: undefined }
    ])
  })
})
