// Functions console (changes: add-console-functions-data-editor, add-console-richer-data-editors).
// Lists/deploys functions, invokes them (showing the result), and shows a selected function's
// recent activations, via the control-plane executor (@/services/functionsApi).
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { ApiError, JsonValue } from '@/lib/http'
import { parseJsonObject } from '@/lib/editor-ux'
import {
  deployFunction,
  invokeFunction,
  listActivations,
  listFunctions,
  type ActivationRecord,
  type FunctionActionWriteRequest,
  type LegacyFunctionDeploySpec,
  type FunctionRecord,
  type InvocationResult
} from '@/services/functionsApi'

export interface FunctionsConsoleProps {
  tenantId: string
  workspaceId: string
}

function errorMessage(error: unknown): string {
  const candidate = error as Partial<ApiError>
  return typeof candidate?.message === 'string' ? candidate.message : 'Request failed'
}

export function FunctionsConsole({ tenantId, workspaceId }: FunctionsConsoleProps) {
  const [functions, setFunctions] = useState<FunctionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [deploySpecJson, setDeploySpecJson] = useState('{"name":"hello","runtime":"nodejs","code":"module.exports=async()=>({ok:true})"}')
  const [selected, setSelected] = useState('')
  const [inputJson, setInputJson] = useState('{}')
  const [result, setResult] = useState<InvocationResult | null>(null)
  const [activations, setActivations] = useState<ActivationRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listFunctions(workspaceId)
      setFunctions(res.items)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void reload()
  }, [reload])

  async function handleDeploy() {
    setError(null)
    setStatus(null)
    const parsed = parseJsonObject(deploySpecJson)
    if (!parsed.ok) {
      setError(`Deploy spec: ${parsed.error}`)
      return
    }
    if (getActionName(parsed.value) === '') {
      setError('Deploy spec must include an "actionName" or legacy "name"')
      return
    }
    setBusy(true)
    try {
      await deployFunction(workspaceId, parsed.value as LegacyFunctionDeploySpec | FunctionActionWriteRequest, tenantId)
      setStatus('Function deployed')
      await reload()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function handleInvoke() {
    if (selected === '') {
      setError('Select a function to invoke')
      return
    }
    setError(null)
    setStatus(null)
    let payload: JsonValue
    try {
      payload = JSON.parse(inputJson) as JsonValue
    } catch {
      setError('Input is not valid JSON')
      return
    }
    setBusy(true)
    try {
      const invocation = await invokeFunction(selected, payload)
      setResult(invocation)
      setStatus('Function invoked')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function handleViewActivations() {
    if (selected === '') {
      setError('Select a function to view activations')
      return
    }
    setBusy(true)
    try {
      const res = await listActivations(selected)
      setActivations(res.items)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Functions console" className="space-y-4">
      {error ? <p role="alert" className="text-sm font-medium text-destructive">{error}</p> : null}
      {status ? <p role="status" className="text-sm font-medium text-foreground">{status}</p> : null}

      <h3 className="text-base font-semibold text-foreground">Functions{functions.length > 0 ? ` (${functions.length})` : ''}</h3>
      {loading ? (
        <p>Loading functions…</p>
      ) : functions.length === 0 ? (
        <p>No functions deployed yet.</p>
      ) : (
        <ul>
          {functions.map((fn) => (
            <li key={fn.resourceId}>
              <label>
                <input
                  type="radio"
                  name="function"
                  value={fn.resourceId}
                  checked={selected === fn.resourceId}
                  onChange={() => setSelected(fn.resourceId)}
                />
                {fn.actionName}
                {fn.execution?.runtime ? ` (${fn.execution.runtime})` : ''}
              </label>
            </li>
          ))}
        </ul>
      )}

      <h3 className="text-base font-semibold text-foreground">Deploy</h3>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="deploy-spec-json">Function spec (JSON)</Label>
        <Textarea id="deploy-spec-json" value={deploySpecJson} onChange={(event) => setDeploySpecJson(event.target.value)} />
        <Button type="button" className="mt-1 self-start" onClick={() => void handleDeploy()} disabled={busy}>
          Deploy
        </Button>
      </div>

      <h3 className="text-base font-semibold text-foreground">Invoke</h3>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="input-json">Input (JSON)</Label>
        <Textarea id="input-json" value={inputJson} onChange={(event) => setInputJson(event.target.value)} />
        <div className="mt-1 flex flex-wrap gap-3">
          <Button type="button" onClick={() => void handleInvoke()} disabled={busy}>
            Invoke
          </Button>
          <Button type="button" variant="outline" onClick={() => void handleViewActivations()} disabled={busy}>
            View activations
          </Button>
        </div>
      </div>
      {result ? (
        <div role="status">
          <h4>Result</h4>
          <pre>{JSON.stringify(result.result ?? result, null, 2)}</pre>
        </div>
      ) : null}

      {activations.length > 0 ? (
        <div aria-label="Activations">
          <h4>Activations</h4>
          <ul>
            {activations.map((activation) => (
              <li key={activation.activationId}>
                {activation.activationId}
                {activation.status ? ` — ${activation.status}` : ''}
                {activation.durationMs != null ? ` (${activation.durationMs}ms)` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

function getActionName(value: Record<string, JsonValue>): string {
  const actionName = value.actionName
  if (typeof actionName === 'string' && actionName.trim() !== '') return actionName
  const legacyName = value.name
  return typeof legacyName === 'string' ? legacyName.trim() : ''
}
