import '@testing-library/jest-dom/vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useReconnectStateSync } from './use-reconnect-state-sync'

const mockRequestConsoleSessionJson = vi.fn()
const mockFetchAsyncOperationQuery = vi.fn()

vi.mock('@/lib/console-session', () => ({
  requestConsoleSessionJson: (...args: unknown[]) => mockRequestConsoleSessionJson(...args)
}))

vi.mock('@/lib/console-operations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/console-operations')>('@/lib/console-operations')
  return {
    ...actual,
    fetchAsyncOperationQuery: (...args: unknown[]) => mockFetchAsyncOperationQuery(...args)
  }
})

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('useReconnectStateSync tenant isolation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockRequestConsoleSessionJson.mockReset()
    mockFetchAsyncOperationQuery.mockReset()
    mockRequestConsoleSessionJson.mockResolvedValue({ ok: true })
    mockFetchAsyncOperationQuery.mockResolvedValue({ queryType: 'list', items: [], total: 0, pagination: { limit: 100, offset: 0 } })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('tenant-a-isolation', async () => {
    renderHook(() => useReconnectStateSync({ tenantId: 'tenant-a', workspaceId: 'wrk-a' }))

    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(500)
      await flush()
    })

    expect(mockFetchAsyncOperationQuery).toHaveBeenCalledWith(
      expect.objectContaining({ filters: expect.objectContaining({ tenantId: 'tenant-a', workspaceId: 'wrk-a' }) }),
      expect.any(AbortSignal)
    )
  })

  it('superadmin-cross-tenant uses provided tenant scope', async () => {
    renderHook(() => useReconnectStateSync({ tenantId: 'tenant-a,tenant-b', workspaceId: null }))

    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(500)
      await flush()
    })

    expect(mockFetchAsyncOperationQuery).toHaveBeenCalledWith(
      expect.objectContaining({ filters: expect.objectContaining({ tenantId: 'tenant-a,tenant-b' }) }),
      expect.any(AbortSignal)
    )
  })

  it('reduced-workspace-on-token-refresh narrows workspace', async () => {
    const snapshots: unknown[] = []
    renderHook(() =>
      useReconnectStateSync({
        tenantId: 'tenant-a',
        workspaceId: 'wrk-a',
        localSnapshot: new Map([
          [
            'op-wrk-b',
            {
              operationId: 'op-wrk-b',
              status: 'running',
              operationType: 'workspace.create',
              tenantId: 'tenant-a',
              workspaceId: 'wrk-b',
              actorId: 'usr-1',
              actorType: 'tenant_owner',
              createdAt: '2026-03-30T10:00:00.000Z',
              updatedAt: '2026-03-30T10:00:00.000Z',
              correlationId: 'corr-op-wrk-b'
            }
          ]
        ]),
        onStateChanged: (delta) => snapshots.push(delta)
      })
    )

    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(500)
      await flush()
    })

    expect((snapshots[0] as { unavailable: string[] }).unavailable).toContain('op-wrk-b')
  })

  it('expired-token-blocks-reread', async () => {
    mockRequestConsoleSessionJson.mockRejectedValue({ status: 401, code: 'HTTP_401', message: 'Unauthorized' })
    const { result } = renderHook(() => useReconnectStateSync({ tenantId: 'tenant-a', workspaceId: 'wrk-a' }))

    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(500)
      await flush()
    })

    expect(result.current.syncError?.name).toBe('ConsoleAuthExpiredError')
    expect(mockFetchAsyncOperationQuery).toHaveBeenCalledTimes(0)
  })
})
