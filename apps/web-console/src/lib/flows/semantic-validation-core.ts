// Pure semantic-validation core shared by the worker and the component layer
// (change: add-console-flow-yaml-editor).
//
// Wraps the SHARED validator (validateFlowSemantics, which delegates to the contract's
// flow-definition-validator.mjs — identical FLW-E001…FLW-E009 rules/messages as the server)
// and the line-anchoring marker mapper. Framework-free and worker-free so it is directly
// unit-testable; the Web Worker (semantic-worker.ts) is a thin transport around this.

import { validateFlowSemantics } from '@/components/flows/semanticValidation'
import { parseYamlToFlow } from '@/lib/flows/yaml-serialiser'
import { toFlowMarkers, type FlowMarker } from '@/lib/flows/semantic-markers'

export interface SemanticRequest {
  yaml: string
  taskTypeCatalog?: string[]
}

export interface SemanticResult {
  // Syntactically parseable YAML?
  parseable: boolean
  // Line-anchored FLW-E markers (empty when the document is clean OR unparseable — a parse
  // error is a separate, structural concern handled by monaco-yaml's own diagnostics).
  markers: FlowMarker[]
}

// Run the FLW-E semantic rule set over a YAML document and return line-anchored markers.
// Never throws: a YAML syntax error yields { parseable: false, markers: [] } so the caller
// can keep the last-valid graph and rely on the structural language service for the syntax
// diagnostic.
export function runFlowSemantics(request: SemanticRequest): SemanticResult {
  let definition
  try {
    definition = parseYamlToFlow(request.yaml)
  } catch {
    return { parseable: false, markers: [] }
  }
  const errors = validateFlowSemantics(definition, {
    taskTypeCatalog:
      request.taskTypeCatalog && request.taskTypeCatalog.length > 0
        ? request.taskTypeCatalog
        : undefined
  })
  return { parseable: true, markers: toFlowMarkers(errors, request.yaml) }
}
