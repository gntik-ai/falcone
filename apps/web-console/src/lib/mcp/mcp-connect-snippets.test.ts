import { describe, expect, it } from 'vitest'

import { generateMcpConnectSnippets } from './mcp-connect-snippets'

const server = { name: 'Acme Orders', endpoint: 'https://gw.example.test/mcp/acme-orders' }

describe('generateMcpConnectSnippets', () => {
  it('renders Cursor deeplink + Claude Code, claude.ai and VS Code snippets', () => {
    const ids = generateMcpConnectSnippets(server).map((s) => s.id)
    expect(ids).toEqual(['mcp-cursor-deeplink', 'mcp-claude-code', 'mcp-claude-ai', 'mcp-vscode'])
  })

  it('Cursor deeplink uses the install scheme with name + base64 config of the endpoint', () => {
    const cursor = generateMcpConnectSnippets(server).find((s) => s.id === 'mcp-cursor-deeplink')!
    expect(cursor.code.startsWith('cursor://anysphere.cursor-deeplink/mcp/install?name=acme-orders&config=')).toBe(true)
    const config = cursor.code.split('config=')[1]
    const decoded = JSON.parse(globalThis.atob(config))
    expect(decoded).toEqual({ url: server.endpoint })
  })

  it('Claude Code and VS Code snippets are valid http-transport JSON pointing at the endpoint', () => {
    const snippets = generateMcpConnectSnippets(server)
    const cc = JSON.parse(snippets.find((s) => s.id === 'mcp-claude-code')!.code)
    expect(cc.mcpServers['acme-orders']).toEqual({ type: 'http', url: server.endpoint })
    const vs = JSON.parse(snippets.find((s) => s.id === 'mcp-vscode')!.code)
    expect(vs.servers['acme-orders']).toEqual({ type: 'http', url: server.endpoint })
  })

  it('claude.ai snippet is the remote server URL', () => {
    const claudeAi = generateMcpConnectSnippets(server).find((s) => s.id === 'mcp-claude-ai')!
    expect(claudeAi.code).toBe(server.endpoint)
  })

  it('embeds no static secret — OAuth handles auth — and every snippet says so', () => {
    for (const s of generateMcpConnectSnippets(server)) {
      expect(s.hasPlaceholderSecrets).toBe(false)
      expect(s.secretPlaceholderRef).toBeNull()
      expect(s.notes.some((n) => n.includes('OAuth 2.1'))).toBe(true)
    }
  })

  it('falls back to the marker + note when the endpoint is not published yet', () => {
    const snippets = generateMcpConnectSnippets({ name: 'Acme', endpoint: null })
    const vs = JSON.parse(snippets.find((s) => s.id === 'mcp-vscode')!.code)
    expect(vs.servers['acme'].url).toBe('<MCP_ENDPOINT>')
    expect(snippets[0].notes.some((n) => n.includes('punto de conexión aún no está publicado'))).toBe(true)
    expect(snippets[0].notes.join('\n')).not.toMatch(/\bplaceholder\b|\bendpoint\b|\bEndpoint\b/)
  })

  it('is deterministic for the same input', () => {
    expect(generateMcpConnectSnippets(server)).toEqual(generateMcpConnectSnippets(server))
  })
})
