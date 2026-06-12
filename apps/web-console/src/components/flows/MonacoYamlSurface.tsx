// Monaco editor host for the flow YAML editor (change: add-console-flow-yaml-editor).
//
// This is the HEAVY module: it statically imports monaco-editor + monaco-yaml and is loaded
// ONLY behind FlowYamlEditor's React.lazy(import()) boundary, so Vite code-splits it (with
// the monaco-chunk) out of the main entry. It must never be imported eagerly.
//
// Responsibilities:
//   - install the Monaco worker environment (editor.worker + monaco-yaml's yaml.worker);
//   - configure monaco-yaml with the INLINE flow-definition JSON Schema (no URI fetch -> no
//     CORS), giving keyword autocomplete, hover docs and structural diagnostics for free;
//   - create the editor over the supplied YAML, bubble value changes up, and expose a hook
//     for the parent to set semantic (FLW-E) markers via monaco.editor.setModelMarkers.
import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import { configureMonacoYaml } from 'monaco-yaml'

import { installMonacoEnvironment } from '@/lib/flows/monaco-environment'
import flowDefinitionSchema from '@in-falcone/internal-contracts/src/flow-definition.json' with { type: 'json' }
import type { FlowMarker } from '@/lib/flows/semantic-markers'

const FLOW_MODEL_URI = 'inmemory://flow/definition.yaml'
const SEMANTIC_MARKER_OWNER = 'flow-semantic'

export interface MonacoYamlSurfaceProps {
  value: string
  onChange: (value: string) => void
  // Semantic FLW-E markers to overlay on top of monaco-yaml's structural diagnostics.
  semanticMarkers: FlowMarker[]
  readOnly?: boolean
}

let monacoYamlConfigured = false

function configureSchemaOnce(): void {
  if (monacoYamlConfigured) return
  monacoYamlConfigured = true
  configureMonacoYaml(monaco, {
    enableSchemaRequest: false,
    hover: true,
    completion: true,
    validate: true,
    schemas: [
      {
        // Inline schema object — fed directly, never fetched (Open Question resolved: the
        // export is a plain JSON object).
        uri: 'inmemory://schema/flow-definition.json',
        fileMatch: ['*'],
        schema: flowDefinitionSchema as object
      }
    ]
  })
}

export default function MonacoYamlSurface({
  value,
  onChange,
  semanticMarkers,
  readOnly
}: MonacoYamlSurfaceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Mount the editor once.
  useEffect(() => {
    installMonacoEnvironment()
    configureSchemaOnce()
    const container = containerRef.current
    if (!container) return

    const uri = monaco.Uri.parse(FLOW_MODEL_URI)
    const model =
      monaco.editor.getModel(uri) ?? monaco.editor.createModel(value, 'yaml', uri)
    model.setValue(value)

    const editor = monaco.editor.create(container, {
      model,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      readOnly: Boolean(readOnly),
      tabSize: 2
    })
    editorRef.current = editor

    const sub = editor.onDidChangeModelContent(() => {
      onChangeRef.current(editor.getValue())
    })

    return () => {
      sub.dispose()
      editor.dispose()
      model.dispose()
      editorRef.current = null
    }
    // Mount-once; value/markers are reconciled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reconcile external value changes (e.g. a canvas edit re-deriving YAML) without losing the
  // user's cursor when the text already matches.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (editor.getValue() !== value) {
      editor.setValue(value)
    }
  }, [value])

  // Overlay the semantic (FLW-E) markers. monaco-yaml owns its own structural markers under a
  // different owner, so the two diagnostic sources coexist.
  useEffect(() => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!model) return
    monaco.editor.setModelMarkers(
      model,
      SEMANTIC_MARKER_OWNER,
      semanticMarkers.map((marker) => ({
        code: marker.code,
        message: marker.message,
        severity:
          marker.severity === 'warning'
            ? monaco.MarkerSeverity.Warning
            : monaco.MarkerSeverity.Error,
        startLineNumber: marker.line,
        startColumn: marker.column,
        endLineNumber: marker.line,
        endColumn: marker.column + 1
      }))
    )
  }, [semanticMarkers])

  return <div ref={containerRef} data-testid="monaco-yaml-surface" className="h-full w-full" />
}
