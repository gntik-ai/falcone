import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { McpServerConnectPanel } from './McpServerConnectPanel'

describe('McpServerConnectPanel', () => {
  it('renders the Cursor deeplink and the Claude Code / claude.ai / VS Code snippets', () => {
    render(<McpServerConnectPanel name="Acme Orders" endpoint="https://gw.example.test/mcp/acme-orders" />)
    expect(screen.getByRole('heading', { name: 'Conecta tu cliente' })).toBeInTheDocument()
    expect(screen.getByText('Cursor — Añadir a Cursor')).toBeInTheDocument()
    expect(screen.getByText('Claude Code — .mcp.json')).toBeInTheDocument()
    expect(screen.getByText('claude.ai — Conector personalizado')).toBeInTheDocument()
    expect(screen.getByText('VS Code — .vscode/mcp.json')).toBeInTheDocument()
    // the Cursor deeplink code block is present
    expect(screen.getByText(/cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install/)).toBeInTheDocument()
  })
})
