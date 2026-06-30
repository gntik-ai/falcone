import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/console-session', () => ({
  requestConsoleSessionJson: vi.fn().mockResolvedValue({})
}))

import { requestConsoleSessionJson } from '@/lib/console-session'
import { deployFunction, getFunction, invokeFunction, listActivations, listFunctions } from './functionsApi'

const mock = requestConsoleSessionJson as unknown as ReturnType<typeof vi.fn>
const lastCall = () => mock.mock.calls[mock.mock.calls.length - 1]
const workspaceActions = '/v1/functions/workspaces/ws1/actions'
const action = '/v1/functions/actions/res_fn_1'

beforeEach(() => {
  mock.mockClear()
  mock.mockResolvedValue({})
})

describe('functionsApi — functions contract routes', () => {
  it('listFunctions → GET workspace actions', async () => {
    await listFunctions('ws1')
    expect(lastCall()).toEqual([workspaceActions])
  })

  it('deployFunction → POST /v1/functions/actions with a contract body mapped from legacy editor JSON', async () => {
    await deployFunction('ws1', { name: 'hello', runtime: 'nodejs', code: 'export default () => 1' }, 'ten_1')
    expect(lastCall()).toEqual([
      '/v1/functions/actions',
      {
        method: 'POST',
        body: {
          tenantId: 'ten_1',
          workspaceId: 'ws1',
          actionName: 'hello',
          source: {
            kind: 'inline_code',
            language: 'javascript',
            inlineCode: 'export default () => 1',
            entryFile: 'index.js'
          },
          execution: {
            runtime: 'nodejs:20',
            entrypoint: 'main',
            parameters: {},
            environment: {},
            limits: { timeoutSeconds: 60, memoryMb: 256 },
            webAction: {
              enabled: false,
              requireAuthentication: true,
              rawHttpResponse: false
            }
          },
          activationPolicy: {
            logsAccess: 'workspace_developers',
            resultAccess: 'workspace_developers',
            rerunPolicy: 'manual_only',
            retentionHours: 168
          }
        }
      }
    ])
  })

  it('deployFunction preserves an already contract-shaped body while stamping the workspaceId', async () => {
    await deployFunction('ws1', {
      tenantId: 'ten_1',
      workspaceId: 'ws_other',
      actionName: 'contract-fn',
      source: { kind: 'inline_code', inlineCode: 'exports.main=()=>({ok:true})', entryFile: 'index.js' },
      execution: {
        runtime: 'python:3.11',
        entrypoint: 'handler',
        parameters: { expected: true },
        environment: {},
        limits: { timeoutSeconds: 5, memoryMb: 512 },
        webAction: { enabled: false, requireAuthentication: true, rawHttpResponse: false }
      },
      activationPolicy: {
        logsAccess: 'workspace_admins',
        resultAccess: 'workspace_admins',
        rerunPolicy: 'blocked',
        retentionHours: 24
      }
    }, 'ten_active')
    expect(lastCall()).toEqual([
      '/v1/functions/actions',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          tenantId: 'ten_active',
          workspaceId: 'ws1',
          actionName: 'contract-fn',
          source: expect.objectContaining({ kind: 'inline_code' }),
          execution: expect.objectContaining({ runtime: 'python:3.11' }),
          activationPolicy: expect.objectContaining({ retentionHours: 24 })
        })
      })
    ])
  })

  it('getFunction → GET actions/{resourceId}', async () => {
    await getFunction('res_fn_1')
    expect(lastCall()).toEqual([action])
  })

  it('invokeFunction → POST actions/{resourceId}/invocations with a parameters envelope', async () => {
    await invokeFunction('res_fn_1', { x: 1 })
    expect(lastCall()).toEqual([`${action}/invocations`, { method: 'POST', body: { parameters: { x: 1 } } }])
  })

  it('invokeFunction preserves an existing invocation envelope', async () => {
    await invokeFunction('res_fn_1', { parameters: { x: 1 }, responseMode: 'wait_for_result' })
    expect(lastCall()).toEqual([
      `${action}/invocations`,
      { method: 'POST', body: { parameters: { x: 1 }, responseMode: 'wait_for_result' } }
    ])
  })

  it('listActivations → GET actions/{resourceId}/activations', async () => {
    await listActivations('res_fn_1')
    expect(lastCall()).toEqual([`${action}/activations`])
  })
})
