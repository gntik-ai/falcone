// Functions console (changes: add-console-functions-data-editor, add-console-richer-data-editors).
// Lists/deploys functions, invokes them (showing the result), and shows a selected function's
// recent activations, via the control-plane executor (@/services/functionsApi).
import { useCallback, useEffect, useState } from 'react'
import { Clock3, Play, Rocket } from 'lucide-react'

import { ConsolePageState } from '@/components/console/ConsolePageState'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { ApiError, JsonValue } from '@/lib/http'
import { parseJsonObject, prettyJson } from '@/lib/editor-ux'
import { cn } from '@/lib/utils'
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

const panelClassName = 'rounded-3xl border border-border bg-card/70 p-5 shadow-sm sm:p-6'
const panelHeaderClassName = 'flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3'
const panelTitleClassName = 'text-sm font-semibold uppercase tracking-wide text-muted-foreground'
const codeBlockClassName = 'overflow-x-auto rounded-sm border border-border/60 bg-muted/30 p-3 font-mono text-xs leading-5 text-foreground'

function errorMessage(error: unknown): string {
  const candidate = error as Partial<ApiError>
  return typeof candidate?.message === 'string' ? candidate.message : 'La solicitud falló'
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
      setError(`Especificación de despliegue: ${localizedJsonError(parsed.error)}`)
      return
    }
    if (getActionName(parsed.value) === '') {
      setError('La especificación de despliegue debe incluir "actionName" o el campo heredado "name"')
      return
    }
    setOperation('deploy')
    try {
      const deployed = await deployFunction(workspaceId, parsed.value as LegacyFunctionDeploySpec | FunctionActionWriteRequest, tenantId)
      setStatus('Función desplegada')
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
      setError('Selecciona una función para invocar')
      return
    }
    setError(null)
    setStatus(null)
    let payload: JsonValue
    try {
      payload = JSON.parse(inputJson) as JsonValue
    } catch {
      setError('La entrada no es JSON válido')
      return
    }
    setOperation('invoke')
    try {
      const invocation = await invokeFunction(selected, payload)
      setResult(invocation)
      setStatus('Función invocada')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setOperation(null)
    }
  }

  async function handleViewActivations() {
    if (selected === '') {
      setError('Selecciona una función para ver activaciones')
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

  function handleFormatDeploySpec() {
    const parsed = parseJsonObject(deploySpecJson)
    if (!parsed.ok) {
      setError(`Especificación de despliegue: ${localizedJsonError(parsed.error)}`)
      return
    }
    setError(null)
    setDeploySpecJson(prettyJson(parsed.value))
  }

  function handleFormatInputJson() {
    try {
      setInputJson(prettyJson(JSON.parse(inputJson) as JsonValue))
      setError(null)
    } catch {
      setError('La entrada no es JSON válido')
    }
  }

  const selectedFunction = functions.find((fn) => fn.resourceId === selected) ?? null
  const busy = operation != null
  const selectedFunctionSummary = selectedFunction
    ? `Función seleccionada: ${formatFunctionLabel(selectedFunction)}.`
    : 'No hay función seleccionada.'

  return (
    <section aria-label="Funciones: despliegue rápido" aria-busy={loading || busy} className="space-y-5">
      <p id="selected-function-summary" className="sr-only" aria-live="polite">
        {selectedFunctionSummary}
      </p>

      {error ? (
        <Alert variant="destructive" aria-live="assertive">
          <AlertTitle>No se pudo completar la solicitud de función</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {status ? (
        <Alert variant="success" role="status" aria-live="polite">
          <AlertTitle>{status}</AlertTitle>
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(16rem,0.82fr)_minmax(0,1.18fr)]">
        {loading ? (
          <ConsolePageState
            kind="loading"
            title="Cargando funciones…"
            description="Consultando las funciones desplegadas del área de trabajo activa."
          />
        ) : functions.length === 0 ? (
          <ConsolePageState
            kind="empty"
            title="No hay funciones desplegadas todavía."
            description="Despliega una función con la especificación JSON para poder invocarla desde esta pantalla."
          />
        ) : (
          <section aria-labelledby="functions-list-heading" className={panelClassName}>
            <div className={panelHeaderClassName}>
              <h2 id="functions-list-heading" className="text-base font-semibold text-foreground">
                Funciones{functions.length > 0 ? ` (${functions.length})` : ''}
              </h2>
              {selectedFunction ? <Badge variant="secondary" className="max-w-full truncate">Seleccionada: {selectedFunction.actionName}</Badge> : null}
            </div>

            <div className="mt-4 space-y-3">
              <fieldset className="space-y-2" aria-describedby="selected-function-summary">
                <legend className="sr-only">Funciones disponibles</legend>
                {functions.map((fn) => {
                  const isSelected = selected === fn.resourceId
                  return (
                    <label
                      key={fn.resourceId}
                      className={cn(
                        'grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-sm border border-border/80 bg-background/40 p-3 text-sm transition-colors hover:bg-muted/40 sm:grid-cols-[auto_minmax(0,1fr)_auto]',
                        isSelected && 'border-primary/70 bg-primary/10'
                      )}
                    >
                      <input
                        type="radio"
                        name="function"
                        value={fn.resourceId}
                        checked={isSelected}
                        onChange={() => handleSelectFunction(fn.resourceId)}
                        aria-label={formatFunctionLabel(fn)}
                        className="row-span-2 h-4 w-4 accent-primary"
                      />
                      <span className="min-w-0 truncate font-medium text-foreground">{fn.actionName}</span>
                      {fn.execution?.runtime ? <Badge variant="outline" className="justify-self-start sm:justify-self-end">{fn.execution.runtime}</Badge> : null}
                      <span className="col-start-2 min-w-0 truncate text-xs text-muted-foreground sm:col-span-2 sm:col-start-2">{fn.resourceId}</span>
                    </label>
                  )
                })}
              </fieldset>

              <p className="text-sm text-muted-foreground" aria-live="polite">
                {selectedFunctionSummary}
              </p>
            </div>
          </section>
        )}

        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <section aria-labelledby="functions-deploy-heading" className={panelClassName}>
              <div className={panelHeaderClassName}>
                <h2 id="functions-deploy-heading" className="text-base font-semibold text-foreground">Desplegar</h2>
              </div>
              <div className="mt-4 flex flex-col gap-2">
                <Label htmlFor="deploy-spec-json">Especificación de función (JSON)</Label>
                <Textarea
                  id="deploy-spec-json"
                  value={deploySpecJson}
                  onChange={(event) => setDeploySpecJson(event.target.value)}
                  aria-describedby="deploy-spec-json-help"
                  aria-invalid={error?.startsWith('Especificación de despliegue') ? true : undefined}
                  className="min-h-36 rounded-sm font-mono text-xs leading-5"
                  disabled={busy}
                />
                <p id="deploy-spec-json-help" className="sr-only">Objeto JSON con actionName o el campo heredado name.</p>
                <div className="mt-1 grid gap-2 sm:flex sm:flex-wrap">
                  <Button type="button" onClick={() => void handleDeploy()} disabled={busy}>
                    <Rocket className="h-4 w-4" aria-hidden="true" />
                    {operation === 'deploy' ? 'Desplegando…' : 'Desplegar'}
                  </Button>
                  <Button type="button" variant="outline" onClick={handleFormatDeploySpec} disabled={busy}>
                    Formatear JSON
                  </Button>
                </div>
              </div>
            </section>

            <section aria-labelledby="functions-invoke-heading" className={panelClassName}>
              <div className={panelHeaderClassName}>
                <h2 id="functions-invoke-heading" className="text-base font-semibold text-foreground">Invocar</h2>
              </div>
              <div className="mt-4 flex flex-col gap-2">
                <Label htmlFor="input-json">Entrada (JSON)</Label>
                <Textarea
                  id="input-json"
                  value={inputJson}
                  onChange={(event) => setInputJson(event.target.value)}
                  aria-describedby="selected-function-summary input-json-help"
                  aria-invalid={error === 'La entrada no es JSON válido' ? true : undefined}
                  className="min-h-28 rounded-sm font-mono text-xs leading-5"
                  disabled={busy}
                />
                <p id="input-json-help" className="sr-only">Valor JSON que se enviará como payload de invocación.</p>
                <div className="mt-1 grid gap-2 sm:flex sm:flex-wrap">
                  <Button type="button" onClick={() => void handleInvoke()} disabled={busy}>
                    <Play className="h-4 w-4" aria-hidden="true" />
                    {operation === 'invoke' ? 'Invocando…' : 'Invocar'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void handleViewActivations()} disabled={busy}>
                    <Clock3 className="h-4 w-4" aria-hidden="true" />
                    {operation === 'activations' ? 'Cargando activaciones…' : 'Ver activaciones'}
                  </Button>
                  <Button type="button" variant="outline" onClick={handleFormatInputJson} disabled={busy}>
                    Formatear JSON
                  </Button>
                </div>
              </div>
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {result ? (
              <section aria-labelledby="functions-result-heading" className={panelClassName} aria-live="polite">
                <div className={panelHeaderClassName}>
                  <h2 id="functions-result-heading" className={panelTitleClassName}>Resultado</h2>
                </div>
                <div className="mt-4">
                  <pre role="status" className={codeBlockClassName}>{JSON.stringify(result.result ?? result, null, 2)}</pre>
                </div>
              </section>
            ) : (
              <ConsolePageState
                kind="empty"
                title="Todavía no hay resultado de invocación."
                description="Selecciona una función y pulsa Invocar para ver la respuesta del runtime."
              />
            )}

            {operation === 'activations' ? (
              <ConsolePageState
                kind="loading"
                title="Cargando activaciones…"
                description="Consultando las activaciones recientes de la función seleccionada."
              />
            ) : activations.length > 0 ? (
              <section aria-labelledby="functions-activations-heading" className={panelClassName} aria-live="polite">
                <div className={panelHeaderClassName}>
                  <h2 id="functions-activations-heading" className={panelTitleClassName}>Activaciones</h2>
                </div>
                <div className="mt-4">
                  <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {activations.map((activation) => (
                      <li key={activation.activationId} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-border/80 bg-background/40 p-3 text-sm">
                        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{activation.activationId}</span>
                        {activation.status ? <Badge variant={statusTone(activation.status)}>{activation.status}</Badge> : null}
                        {activation.durationMs != null ? <span className="text-xs tabular-nums text-muted-foreground">({activation.durationMs}ms)</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            ) : activationsLoaded ? (
              <ConsolePageState
                kind="empty"
                title="No hay activaciones para esta función."
                description={selectedFunction ? `${selectedFunction.actionName} no tiene activaciones registradas todavía.` : 'La función seleccionada no tiene activaciones registradas todavía.'}
              />
            ) : (
              <ConsolePageState
                kind="empty"
                title="Todavía no se consultaron activaciones."
                description="Selecciona una función y pulsa Ver activaciones para consultar ejecuciones recientes."
              />
            )}
          </div>
        </div>
      </div>
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

function localizedJsonError(error: string): string {
  if (error === 'Not valid JSON') return 'JSON no válido'
  if (error === 'Expected a JSON object') return 'Se esperaba un objeto JSON'
  return error
}

function statusTone(value?: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const normalized = value?.toLowerCase()
  if (normalized === 'success' || normalized === 'succeeded' || normalized === 'completed') return 'secondary'
  if (normalized === 'failed' || normalized === 'error' || normalized === 'rejected') return 'destructive'
  if (normalized === 'running' || normalized === 'pending' || normalized === 'accepted') return 'default'
  return 'outline'
}
