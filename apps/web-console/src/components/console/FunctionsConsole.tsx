// Functions console (change: add-console-functions-data-editor).
// Lists/deploys functions and invokes them, showing the result, via the control-plane
// executor (@/services/functionsApi).
import { useCallback, useEffect, useState } from 'react'

import type { ApiError, JsonValue } from '@/lib/http'
import {
  deployFunction,
  invokeFunction,
  listFunctions,
  type FunctionRecord,
  type InvocationResult
} from '@/services/functionsApi'

export interface FunctionsConsoleProps {
  workspaceId: string
}

function errorMessage(error: unknown): string {
  const candidate = error as Partial<ApiError>
  return typeof candidate?.message === 'string' ? candidate.message : 'Request failed'
}

export function FunctionsConsole({ workspaceId }: FunctionsConsoleProps) {
  const [functions, setFunctions] = useState<FunctionRecord[]>([])
  const [deploySpecJson, setDeploySpecJson] = useState('{"name":"hello","runtime":"nodejs","code":"module.exports=async()=>({ok:true})"}')
  const [selected, setSelected] = useState('')
  const [inputJson, setInputJson] = useState('{}')
  const [result, setResult] = useState<InvocationResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      const res = await listFunctions(workspaceId)
      setFunctions(res.items)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }, [workspaceId])

  useEffect(() => {
    void reload()
  }, [reload])

  async function handleDeploy() {
    setError(null)
    setBusy(true)
    try {
      const spec = JSON.parse(deploySpecJson) as { name: string } & Record<string, JsonValue>
      await deployFunction(workspaceId, spec)
      await reload()
    } catch (caught) {
      setError(caught instanceof SyntaxError ? 'Deploy spec is not valid JSON' : errorMessage(caught))
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
    setBusy(true)
    try {
      const payload = JSON.parse(inputJson) as JsonValue
      const invocation = await invokeFunction(workspaceId, selected, payload)
      setResult(invocation)
    } catch (caught) {
      setError(caught instanceof SyntaxError ? 'Input is not valid JSON' : errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Functions console">
      {error ? <p role="alert">{error}</p> : null}

      <h3>Functions</h3>
      <ul>
        {functions.map((fn) => (
          <li key={fn.name}>
            <label>
              <input
                type="radio"
                name="function"
                value={fn.name}
                checked={selected === fn.name}
                onChange={() => setSelected(fn.name)}
              />
              {fn.name}
              {fn.runtime ? ` (${fn.runtime})` : ''}
            </label>
          </li>
        ))}
      </ul>

      <h3>Deploy</h3>
      <label htmlFor="deploy-spec-json">Function spec (JSON)</label>
      <textarea id="deploy-spec-json" value={deploySpecJson} onChange={(event) => setDeploySpecJson(event.target.value)} />
      <button type="button" onClick={() => void handleDeploy()} disabled={busy}>
        Deploy
      </button>

      <h3>Invoke</h3>
      <label htmlFor="input-json">Input (JSON)</label>
      <textarea id="input-json" value={inputJson} onChange={(event) => setInputJson(event.target.value)} />
      <button type="button" onClick={() => void handleInvoke()} disabled={busy}>
        Invoke
      </button>
      {result ? (
        <div role="status">
          <h4>Result</h4>
          <pre>{JSON.stringify(result.result ?? result, null, 2)}</pre>
        </div>
      ) : null}
    </section>
  )
}
