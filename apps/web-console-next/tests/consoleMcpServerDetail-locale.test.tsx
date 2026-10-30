import { render } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { forbiddenMcpCopy, mcpLocaleValues } from './parity/pages/consoleMcpServerDetail.locale'

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
})

test('MCP locale coverage includes page copy, accessible names, owned popups and announcements', () => {
  render(<>
    <section aria-label="Active context"><button>Select workspace</button></section>
    <div className="console-mcp-server-detail">
      <h1>Servidor MCP</h1><input aria-label="Herramienta" placeholder="Seleccionar herramienta" />
      <button aria-controls="mcp-popup" title="Reintentar">Reintentar</button><img alt="Servidor" />
    </div>
    <div id="mcp-popup" role="listbox"><span id="mcp-option-label">Herramienta publicada</span><div role="option" aria-labelledby="mcp-option-label">list_orders</div></div>
    <div className="console-mcp-server-detail-announcements" aria-live="polite">Copiado al portapapeles</div>
  </>)
  const values = mcpLocaleValues()
  for (const text of ['Servidor MCP', 'Herramienta', 'Seleccionar herramienta', 'Reintentar', 'Servidor', 'Herramienta publicada', 'list_orders', 'Copiado al portapapeles']) expect(values).toContain(text)
  expect(values).not.toContain('Select workspace')
})

test('Spanish locale rules still reject English and raw keys on every MCP-owned surface', async () => {
  render(<>
    <div className="console-mcp-server-detail">
      <input placeholder="Select workspace" /><button aria-controls="mcp-popup">Loading…</button>
      <span>pages.untranslated</span>
    </div>
    <div id="mcp-popup" role="listbox"><div role="option" aria-label="Select an option">Test area</div></div>
    <div className="console-mcp-server-detail-announcements" aria-live="assertive">Invocation failed. Try again.</div>
  </>)
  const forbidden = await forbiddenMcpCopy('es')
  const unexpected = mcpLocaleValues().filter((text) => /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/.test(text) || forbidden.has(text))
  for (const text of ['Select workspace', 'Loading…', 'pages.untranslated', 'Select an option', 'Test area', 'Invocation failed. Try again.']) expect(unexpected).toContain(text)
  expect((await forbiddenMcpCopy('en')).has('Test area')).toBe(false)
})
