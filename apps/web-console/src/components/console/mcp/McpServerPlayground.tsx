import { useState } from 'react'

import type { JsonValue } from '@/lib/http'
import { invokeMcpTool, type InvokeMcpToolResult } from '@/lib/mcp/mcp-api'
import type { McpToolView } from '@/lib/mcp/mcp-server-detail'

/**
 * Interactive playground (issue #397): pick a curated tool, supply JSON arguments, and invoke it
 * through the gateway via the console's OAuth session (#390); the structured result is shown.
 * The invoker is injectable for testing (defaults to the real OAuth-backed call).
 */
interface McpServerPlaygroundProps {
  serverId: string
  tools: McpToolView[]
  endpoint: string | null
  /** Injection point for tests; defaults to the OAuth-backed control-plane call. */
  invoke?: (serverId: string, toolName: string, args: Record<string, JsonValue>) => Promise<InvokeMcpToolResult>
}

export function McpServerPlayground({ serverId, tools, endpoint, invoke = invokeMcpTool }: McpServerPlaygroundProps) {
  const [toolName, setToolName] = useState<string>(tools[0]?.name ?? '')
  const [argsText, setArgsText] = useState<string>('{}')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<InvokeMcpToolResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const disabled = !endpoint || !toolName || busy

  async function handleInvoke() {
    setError(null)
    setResult(null)
    let parsed: Record<string, JsonValue>
    try {
      parsed = JSON.parse(argsText || '{}') as Record<string, JsonValue>
    } catch {
      setError('Los argumentos deben ser JSON válido.')
      return
    }
    setBusy(true)
    try {
      const res = await invoke(serverId, toolName, parsed)
      setResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La invocación falló.')
    } finally {
      setBusy(false)
    }
  }

  if (tools.length === 0) {
    return <p className="text-sm text-muted-foreground">Este servidor aún no expone herramientas curadas.</p>
  }

  return (
    <div className="space-y-4" data-testid="mcp-playground">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-foreground">Playground</h3>
        <p className="text-sm text-muted-foreground">
          Prueba una herramienta a través del flujo OAuth antes de conectar un cliente.
        </p>
      </div>

      <label className="block text-sm font-medium text-foreground">
        Herramienta
        <select
          className="mt-1 block w-full rounded-md border border-border bg-background p-2 text-sm"
          value={toolName}
          onChange={(event) => setToolName(event.target.value)}
          aria-label="Herramienta"
        >
          {tools.map((tool) => (
            <option key={tool.name} value={tool.name}>
              {tool.name}
              {tool.mutates ? ' (muta)' : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm font-medium text-foreground">
        Argumentos (JSON)
        <textarea
          className="mt-1 block w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
          rows={5}
          value={argsText}
          onChange={(event) => setArgsText(event.target.value)}
          aria-label="Argumentos (JSON)"
        />
      </label>

      <button
        type="button"
        className="rounded-md border border-border px-3 py-1 text-sm font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
        onClick={() => void handleInvoke()}
        disabled={disabled}
      >
        {busy ? 'Invocando…' : 'Invocar'}
      </button>

      {error ? (
        <p className="text-sm text-destructive" role="alert">{error}</p>
      ) : null}

      {result ? (
        <pre
          className="overflow-x-auto rounded-xl bg-muted/50 p-3 text-xs leading-6 text-foreground whitespace-pre-wrap"
          data-testid="mcp-playground-result"
        >
          <code>{JSON.stringify(result, null, 2)}</code>
        </pre>
      ) : null}
    </div>
  )
}
