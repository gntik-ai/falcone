import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { McpServerPlayground } from './McpServerPlayground'

const tools = [
  { name: 'list_orders', description: 'list', mutates: false, scope: null },
  { name: 'create_order', description: 'create', mutates: true, scope: 'mcp:orders:write' }
]

describe('McpServerPlayground', () => {
  it('invokes the selected tool via the injected OAuth-backed call and shows the structured result', async () => {
    const user = userEvent.setup()
    const invoke = vi.fn().mockResolvedValue({ result: { content: [{ type: 'text', text: 'ok' }] } })
    render(<McpServerPlayground serverId="srv_1" tools={tools} endpoint="https://gw.example.test/mcp/x" invoke={invoke} />)

    await user.clear(screen.getByLabelText('Argumentos (JSON)'))
    await user.type(screen.getByLabelText('Argumentos (JSON)'), '{{"limit":5}')
    await user.click(screen.getByRole('button', { name: 'Invocar' }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('srv_1', 'list_orders', { limit: 5 }))
    expect(screen.getByTestId('mcp-playground-result')).toHaveTextContent('"text": "ok"')
  })

  it('rejects invalid JSON arguments before calling', async () => {
    const user = userEvent.setup()
    const invoke = vi.fn()
    render(<McpServerPlayground serverId="srv_1" tools={tools} endpoint="https://gw.example.test/mcp/x" invoke={invoke} />)

    await user.clear(screen.getByLabelText('Argumentos (JSON)'))
    await user.type(screen.getByLabelText('Argumentos (JSON)'), 'not-json')
    await user.click(screen.getByRole('button', { name: 'Invocar' }))

    expect(invoke).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('JSON válido')
  })

  it('disables invocation when the endpoint is not published', () => {
    render(<McpServerPlayground serverId="srv_1" tools={tools} endpoint={null} invoke={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Invocar' })).toBeDisabled()
  })
})
