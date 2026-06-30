// Functions console (changes: add-console-functions-data-editor, add-console-richer-data-editors).
// Lists/deploys functions, invokes them (showing the result), and shows a selected function's
// recent activations, via the control-plane executor (@/services/functionsApi).
import { useCallback, useEffect, useState } from 'react'
import { Clock3, Play, Rocket } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
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

type FunctionOperation = 'deploy' | 'invoke' | 'activations'

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
  const [activationsLoaded, setActivationsLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [operation, setOperation] = useState<FunctionOperation | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listFunctions(workspaceId)
      setFunctions(res.items)
      setSelected((current) => res.items.some((fn) => fn.resourceId === current) ? current : '')
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
    setOperation('deploy')
    try {
      const deployed = await deployFunction(workspaceId, parsed.value as LegacyFunctionDeploySpec | FunctionActionWriteRequest, tenantId)
      setStatus('Function deployed')
      setSelected(deployed.resourceId)
      setResult(null)
      setActivations([])
      setActivationsLoaded(false)
      await reload()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setOperation(null)
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
    setOperation('invoke')
    try {
      const invocation = await invokeFunction(selected, payload)
      setResult(invocation)
      setStatus('Function invoked')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setOperation(null)
    }
  }

  async function handleViewActivations() {
    if (selected === '') {
      setError('Select a function to view activations')
      return
    }
    setError(null)
    setStatus(null)
    setOperation('activations')
    try {
      const res = await listActivations(selected)
      setActivations(res.items)
      setActivationsLoaded(true)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setOperation(null)
    }
  }

  function handleSelectFunction(resourceId: string) {
    setSelected(resourceId)
    setError(null)
    setStatus(null)
    setResult(null)
    setActivations([])
    setActivationsLoaded(false)
  }

  const selectedFunction = functions.find((fn) => fn.resourceId === selected) ?? null
  const busy = operation != null

  return (
    <section aria-label="Functions console" aria-busy={loading || busy} className="space-y-6">
      {error ? (
        <Alert variant="destructive" aria-live="assertive">
          <AlertTitle>Function request failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {status ? (
        <Alert variant="success" role="status" aria-live="polite">
          <AlertTitle>{status}</AlertTitle>
        </Alert>
      ) : null}

      <section aria-labelledby="functions-list-heading" className="space-y-3 rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="functions-list-heading" className="text-base font-semibold text-foreground">
            Functions{functions.length > 0 ? ` (${functions.length})` : ''}
          </h3>
          {selectedFunction ? <Badge variant="secondary">Selected: {selectedFunction.actionName}</Badge> : null}
        </div>

        {loading ? (
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">Loading functions…</p>
        ) : functions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            <p>No functions deployed yet.</p>
          </div>
        ) : (
          <fieldset className="space-y-2" aria-describedby="selected-function-summary">
            <legend className="sr-only">Available functions</legend>
            {functions.map((fn) => (
              <label
                key={fn.resourceId}
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-border p-3 text-sm transition-colors hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary/10"
              >
                <input
                  type="radio"
                  name="function"
                  value={fn.resourceId}
                  checked={selected === fn.resourceId}
                  onChange={() => handleSelectFunction(fn.resourceId)}
                  aria-label={formatFunctionLabel(fn)}
                  className="h-4 w-4 accent-primary"
                />
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{fn.actionName}</span>
                {fn.execution?.runtime ? <Badge variant="outline">{fn.execution.runtime}</Badge> : null}
              </label>
            ))}
          </fieldset>
        )}

        <p id="selected-function-summary" className="text-sm text-muted-foreground" aria-live="polite">
          {selectedFunction ? `Selected function: ${formatFunctionLabel(selectedFunction)}.` : 'No function selected.'}
        </p>
      </section>

      <section aria-labelledby="functions-deploy-heading" className="space-y-3 rounded-xl border border-border p-4">
        <h3 id="functions-deploy-heading" className="text-base font-semibold text-foreground">Deploy</h3>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="deploy-spec-json">Function spec (JSON)</Label>
          <Textarea
            id="deploy-spec-json"
            value={deploySpecJson}
            onChange={(event) => setDeploySpecJson(event.target.value)}
            aria-describedby="deploy-spec-json-help"
            aria-invalid={error?.startsWith('Deploy spec') ? true : undefined}
            className="min-h-36 font-mono"
            disabled={busy}
          />
          <p id="deploy-spec-json-help" className="sr-only">JSON object containing actionName or legacy name.</p>
          <Button type="button" className="mt-1 self-start" onClick={() => void handleDeploy()} disabled={busy}>
            <Rocket className="h-4 w-4" aria-hidden="true" />
            {operation === 'deploy' ? 'Deploying…' : 'Deploy'}
          </Button>
        </div>
      </section>

      <section aria-labelledby="functions-invoke-heading" className="space-y-3 rounded-xl border border-border p-4">
        <h3 id="functions-invoke-heading" className="text-base font-semibold text-foreground">Invoke</h3>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="input-json">Input (JSON)</Label>
          <Textarea
            id="input-json"
            value={inputJson}
            onChange={(event) => setInputJson(event.target.value)}
            aria-describedby="selected-function-summary input-json-help"
            aria-invalid={error === 'Input is not valid JSON' ? true : undefined}
            className="min-h-28 font-mono"
            disabled={busy}
          />
          <p id="input-json-help" className="sr-only">JSON value to send as the invocation payload.</p>
          <div className="mt-1 flex flex-wrap gap-3">
            <Button type="button" onClick={() => void handleInvoke()} disabled={busy}>
              <Play className="h-4 w-4" aria-hidden="true" />
              {operation === 'invoke' ? 'Invoking…' : 'Invoke'}
            </Button>
            <Button type="button" variant="outline" onClick={() => void handleViewActivations()} disabled={busy}>
              <Clock3 className="h-4 w-4" aria-hidden="true" />
              {operation === 'activations' ? 'Loading activations…' : 'View activations'}
            </Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="functions-result-heading" className="space-y-3 rounded-xl border border-border p-4" aria-live="polite">
        <h4 id="functions-result-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Result</h4>
        {result ? (
          <pre role="status" className="overflow-x-auto rounded-xl bg-muted/40 p-3 text-xs text-foreground">{JSON.stringify(result.result ?? result, null, 2)}</pre>
        ) : (
          <p className="text-sm text-muted-foreground">No invocation result yet.</p>
        )}
      </section>

      <section aria-labelledby="functions-activations-heading" className="space-y-3 rounded-xl border border-border p-4" aria-live="polite">
        <h4 id="functions-activations-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Activations</h4>
        {operation === 'activations' ? (
          <p role="status" className="text-sm text-muted-foreground">Loading activations…</p>
        ) : activations.length > 0 ? (
          <ul className="space-y-2">
            {activations.map((activation) => (
              <li key={activation.activationId} className="rounded-xl border border-border p-3 text-sm">
                <span className="font-medium text-foreground">{activation.activationId}</span>
                {activation.status ? <span className="text-muted-foreground"> — {activation.status}</span> : null}
                {activation.durationMs != null ? <span className="text-muted-foreground"> ({activation.durationMs}ms)</span> : null}
              </li>
            ))}
          </ul>
        ) : activationsLoaded ? (
          <p className="text-sm text-muted-foreground">No activations for this function.</p>
        ) : (
          <p className="text-sm text-muted-foreground">No activation lookup run yet.</p>
        )}
      </section>
    </section>
  )
}

function formatFunctionLabel(fn: FunctionRecord): string {
  return `${fn.actionName}${fn.execution?.runtime ? ` (${fn.execution.runtime})` : ''}`
}

function getActionName(value: Record<string, JsonValue>): string {
  const actionName = value.actionName
  if (typeof actionName === 'string' && actionName.trim() !== '') return actionName
  const legacyName = value.name
  return typeof legacyName === 'string' ? legacyName.trim() : ''
}
