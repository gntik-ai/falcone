// Flow YAML editor (change: add-console-flow-yaml-editor).
//
// The public, lazily-loaded entry point for the Monaco-backed YAML editor. The heavy Monaco
// host (MonacoYamlSurface) is pulled in via React.lazy(import()), so monaco-editor/monaco-yaml
// land in the dedicated monaco-chunk and never touch the console's main entry bundle.
//
// Responsibilities beyond hosting Monaco:
//   - run the FLW-E semantic rule set on every document change (in a Web Worker when one can
//     be constructed; otherwise synchronously via the shared core — the path jsdom tests take)
//     and feed the resulting line-anchored markers down to the surface;
//   - track document validity (syntactic + semantic) and report it up via onValidityChange so
//     the draft-save guard at the call site can suppress PATCH /flows/:id while invalid.
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { runFlowSemantics } from '@/lib/flows/semantic-validation-core'
import { isParseableYaml } from '@/lib/flows/yaml-serialiser'
import type { FlowMarker } from '@/lib/flows/semantic-markers'

// Lazy boundary: importing MonacoYamlSurface (and therefore Monaco) is deferred until the
// editor view is actually rendered.
const MonacoYamlSurface = lazy(() => import('@/components/flows/MonacoYamlSurface'))

export interface FlowEditorValidity {
  parseable: boolean
  // No syntactic error AND no semantic (FLW-E) markers.
  valid: boolean
  markers: FlowMarker[]
}

export interface FlowYamlEditorProps {
  value: string
  onChange: (value: string) => void
  taskTypeCatalog?: string[]
  // Reports document validity after each change; the host uses `valid` as the draft-save guard.
  onValidityChange?: (validity: FlowEditorValidity) => void
  readOnly?: boolean
}

// Attempt to build the module worker; returns null in environments (jsdom) where Worker or
// import.meta worker URLs are unavailable, so the editor falls back to synchronous validation.
function createSemanticWorker(): Worker | null {
  try {
    if (typeof Worker === 'undefined') return null
    return new Worker(new URL('@/lib/flows/semantic-worker.ts', import.meta.url), {
      type: 'module'
    })
  } catch {
    return null
  }
}

export function FlowYamlEditor({
  value,
  onChange,
  taskTypeCatalog,
  onValidityChange,
  readOnly
}: FlowYamlEditorProps) {
  const [markers, setMarkers] = useState<FlowMarker[]>([])
  const workerRef = useRef<Worker | null>(null)
  const requestIdRef = useRef(0)
  const onValidityRef = useRef(onValidityChange)
  onValidityRef.current = onValidityChange
  const catalog = useMemo(() => taskTypeCatalog ?? [], [taskTypeCatalog])

  // Spin up the worker once (best effort). Listen for marker responses.
  useEffect(() => {
    const worker = createSemanticWorker()
    workerRef.current = worker
    if (!worker) return
    worker.onmessage = (event: MessageEvent<{ requestId: number; parseable: boolean; markers: FlowMarker[] }>) => {
      // Ignore stale responses.
      if (event.data.requestId !== requestIdRef.current) return
      setMarkers(event.data.markers)
      onValidityRef.current?.({
        parseable: event.data.parseable,
        valid: event.data.parseable && event.data.markers.length === 0,
        markers: event.data.markers
      })
    }
    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  // Validate on every value (or catalog) change. Prefer the worker; fall back to synchronous
  // validation when there is none (jsdom, or worker construction failed).
  const validate = useCallback(
    (text: string) => {
      const requestId = (requestIdRef.current += 1)
      const worker = workerRef.current
      if (worker) {
        worker.postMessage({ requestId, yaml: text, taskTypeCatalog: catalog })
        return
      }
      const result = runFlowSemantics({ yaml: text, taskTypeCatalog: catalog })
      setMarkers(result.markers)
      onValidityRef.current?.({
        parseable: result.parseable,
        valid: result.parseable && result.markers.length === 0,
        markers: result.markers
      })
    },
    [catalog]
  )

  useEffect(() => {
    validate(value)
  }, [value, validate])

  const handleChange = useCallback(
    (next: string) => {
      onChange(next)
      validate(next)
    },
    [onChange, validate]
  )

  const syntaxOk = isParseableYaml(value)

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="flow-yaml-editor" data-yaml-valid={String(syntaxOk)}>
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground" data-testid="flow-yaml-editor-loading">
            Cargando editor…
          </div>
        }
      >
        <MonacoYamlSurface
          value={value}
          onChange={handleChange}
          semanticMarkers={markers}
          readOnly={readOnly}
        />
      </Suspense>
    </div>
  )
}

export default FlowYamlEditor
