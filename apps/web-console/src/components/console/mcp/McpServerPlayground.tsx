import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { JsonValue } from '@/lib/http'
import { invokeMcpTool, type InvokeMcpToolResult } from '@/lib/mcp/mcp-api'
import type { McpToolView } from '@/lib/mcp/mcp-server-detail'

/**
 * Interactive playground (issue #397): pick a curated tool, supply JSON arguments, and invoke it
 * through the gateway via the console's OAuth session (#390); the structured result is shown.
 * The invoker is injectable for testing (defaults to the real OAuth-backed call).
 */
interface McpServerPlaygroundProps {
  workspaceId: string
  serverId: string
  tools: McpToolView[]
  endpoint: string | null
  /** Injection point for tests; defaults to the OAuth-backed control-plane call. */
  invoke?: (
    workspaceId: string,
    serverId: string,
    toolName: string,
    args: Record<string, JsonValue>
  ) => Promise<InvokeMcpToolResult>
}

const invalidJsonMessage = 'Los argumentos deben ser JSON válido.'

export function McpServerPlayground({
  workspaceId,
  serverId,
  tools,
  endpoint,
  invoke = invokeMcpTool
}: McpServerPlaygroundProps) {
  const [toolName, setToolName] = useState<string>(tools[0]?.name ?? '')
  const [argsText, setArgsText] = useState<string>('{}')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<InvokeMcpToolResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (tools.length === 0) {
      setToolName('')
      return
    }
    if (!tools.some((tool) => tool.name === toolName)) {
      setToolName(tools[0].name)
    }
  }, [toolName, tools])

  const selectedTool = useMemo(
    () => tools.find((tool) => tool.name === toolName) ?? tools[0] ?? null,
    [toolName, tools]
  )
  const argsInvalid = error === invalidJsonMessage
  const disabled = !endpoint || !toolName || busy

  async function handleInvoke(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setResult(null)
    let parsed: Record<string, JsonValue>
    try {
      parsed = JSON.parse(argsText || '{}') as Record<string, JsonValue>
    } catch {
      setError(invalidJsonMessage)
      return
    }
    setBusy(true)
    try {
      const res = await invoke(workspaceId, serverId, toolName, parsed)
      setResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La invocación falló.')
    } finally {
      setBusy(false)
    }
  }

  if (tools.length === 0) {
    return (
      <section
        className="space-y-1 rounded-md border border-dashed border-border bg-muted/20 p-4"
        role="status"
        aria-labelledby="mcp-playground-empty-heading"
      >
        <h3 id="mcp-playground-empty-heading" className="text-lg font-semibold text-foreground">Playground no disponible</h3>
        <p className="text-sm text-muted-foreground">Este servidor aún no expone herramientas curadas para invocar.</p>
      </section>
    )
  }

  return (
    <form className="space-y-4" data-testid="mcp-playground" aria-busy={busy} onSubmit={(event) => void handleInvoke(event)}>
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-foreground">Playground</h3>
        <p className="text-sm text-muted-foreground">
          Prueba una herramienta a través del flujo OAuth antes de conectar un cliente.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="mcp-playground-tool">Herramienta</Label>
        <Select
          id="mcp-playground-tool"
          value={toolName}
          onChange={(event) => setToolName(event.target.value)}
          disabled={busy}
          aria-describedby={selectedTool ? 'mcp-playground-tool-context' : undefined}
        >
          {tools.map((tool) => (
            <option key={tool.name} value={tool.name}>
              {tool.name}
              {tool.mutates ? ' (muta)' : ''}
            </option>
          ))}
        </Select>
        {selectedTool ? (
          <div id="mcp-playground-tool-context" className="space-y-1 text-sm text-muted-foreground">
            {selectedTool.description ? <p>{selectedTool.description}</p> : null}
            <p>
              {selectedTool.mutates ? 'Puede modificar datos.' : 'Solo lectura según la definición publicada.'}
              {selectedTool.scope ? ` Scope sugerido: ${selectedTool.scope}.` : ''}
            </p>
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="mcp-playground-args">Argumentos (JSON)</Label>
        <Textarea
          id="mcp-playground-args"
          className="font-mono text-xs"
          rows={5}
          value={argsText}
          onChange={(event) => setArgsText(event.target.value)}
          disabled={busy}
          aria-describedby={error ? 'mcp-playground-args-help mcp-playground-error' : 'mcp-playground-args-help'}
          aria-invalid={argsInvalid ? 'true' : undefined}
        />
        <p id="mcp-playground-args-help" className="text-sm text-muted-foreground">
          Usa un objeto JSON. Deja <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">{'{}'}</code> si la herramienta no requiere argumentos.
        </p>
      </div>

      {!endpoint ? (
        <Alert role="status" aria-live="polite">
          <AlertTitle>Endpoint no publicado</AlertTitle>
          <AlertDescription>El playground se habilitará cuando el servidor MCP tenga un endpoint publicado.</AlertDescription>
        </Alert>
      ) : null}

      <Button
        type="submit"
        variant="outline"
        aria-busy={busy}
        disabled={disabled}
      >
        {busy ? 'Invocando…' : 'Invocar'}
      </Button>

      {error ? (
        <p id="mcp-playground-error" className="text-sm text-destructive" role="alert">{error}</p>
      ) : null}

      {result ? (
        <section className="space-y-2" aria-labelledby="mcp-playground-result-heading">
          <h4 id="mcp-playground-result-heading" className="text-sm font-medium text-foreground">Resultado</h4>
          <pre
            className="overflow-x-auto rounded-xl bg-muted/50 p-3 text-xs leading-6 text-foreground whitespace-pre-wrap"
            data-testid="mcp-playground-result"
            role="status"
            aria-live="polite"
          >
            <code>{JSON.stringify(result, null, 2)}</code>
          </pre>
        </section>
      ) : null}
    </form>
  )
}
