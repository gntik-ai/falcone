import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/console-session', () => ({
  requestConsoleSessionJson: vi.fn().mockResolvedValue({})
}))

import { requestConsoleSessionJson } from '@/lib/console-session'
import { deployFunction, getFunction, invokeFunction, listActivations, listFunctions } from './functionsApi'

const mock = requestConsoleSessionJson as unknown as ReturnType<typeof vi.fn>
const lastCall = () => mock.mock.calls[mock.mock.calls.length - 1]
const actions = '/v1/functions/workspaces/ws1/actions'

beforeEach(() => {
  mock.mockClear()
  mock.mockResolvedValue({})
})

describe('functionsApi — executor function routes (workspace-scoped)', () => {
  it('listFunctions → GET actions', async () => {
    await listFunctions('ws1')
    expect(lastCall()).toEqual([actions])
  })

  it('deployFunction → POST actions with the spec', async () => {
    await deployFunction('ws1', { name: 'hello', runtime: 'nodejs', code: 'export default () => 1' })
    expect(lastCall()).toEqual([actions, { method: 'POST', body: { name: 'hello', runtime: 'nodejs', code: 'export default () => 1' } }])
  })

  it('getFunction → GET actions/{name}', async () => {
    await getFunction('ws1', 'hello')
    expect(lastCall()).toEqual([`${actions}/hello`])
  })

  it('invokeFunction → POST actions/{name}/invocations with the payload', async () => {
    await invokeFunction('ws1', 'hello', { x: 1 })
    expect(lastCall()).toEqual([`${actions}/hello/invocations`, { method: 'POST', body: { x: 1 } }])
  })

  it('listActivations → GET actions/{name}/activations', async () => {
    await listActivations('ws1', 'hello')
    expect(lastCall()).toEqual([`${actions}/hello/activations`])
  })
})
