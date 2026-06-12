// Graph <-> YAML round-trip helpers (change: add-console-flow-yaml-editor).
//
// Sits one layer above the deterministic serialiser (yaml-serialiser.ts) and the shared
// graph model (flowGraphModel.ts). It exposes the two directions the view switcher needs:
//   - canvas graph (nodes + edges)  -> canonical YAML       (graphToYaml)
//   - YAML text                     -> canvas graph + DSL    (yamlToGraph)
// plus a pure equality helper the property-based round-trip tests use, which compares
// execution semantics and canvasMetadata independently (canvasMetadata is layout-only and
// is never allowed to mask a semantic regression).
//
// The serialiser is the single source of determinism; this module only adapts the canvas
// node/edge arrays to/from a FlowDefinition before delegating.

import {
  definitionToEdges,
  definitionToNodes,
  nodesToDefinition,
  type FlowCanvasEdge,
  type FlowCanvasNode
} from '@/components/flows/flowGraphModel'
import { parseYamlToFlow, serializeFlowToYaml } from '@/lib/flows/yaml-serialiser'
import type { FlowDefinition } from '@/types/flows'

export interface FlowGraph {
  definition: FlowDefinition
  nodes: FlowCanvasNode[]
  edges: FlowCanvasEdge[]
}

// Build the canvas graph (nodes + edges) for a definition, keeping the definition as the
// authoritative model the canvas projects back to on save.
export function definitionToGraph(definition: FlowDefinition): FlowGraph {
  return {
    definition,
    nodes: definitionToNodes(definition),
    edges: definitionToEdges(definition)
  }
}

// Project a live canvas graph back to a FlowDefinition (exactly what a save would persist),
// then serialise to canonical YAML.
export function graphToYaml(graph: FlowGraph): string {
  const definition = nodesToDefinition(graph.definition, graph.nodes, graph.edges)
  return serializeFlowToYaml(definition)
}

// Serialise a FlowDefinition directly to YAML (when the caller already holds the DSL model).
export function definitionToYaml(definition: FlowDefinition): string {
  return serializeFlowToYaml(definition)
}

// Parse YAML text into a canvas graph. Throws (via parseYamlToFlow) on syntactically invalid
// YAML so the caller can keep the last-valid graph and degrade gracefully.
export function yamlToGraph(yaml: string): FlowGraph {
  const definition = parseYamlToFlow(yaml)
  return definitionToGraph(definition)
}

// Strip canvasMetadata from a definition for an execution-semantics-only comparison.
function withoutCanvasMetadata(definition: FlowDefinition): Omit<FlowDefinition, 'canvasMetadata'> {
  const { canvasMetadata: _ignored, ...rest } = definition
  return rest
}

export interface RoundTripComparison {
  semanticsEqual: boolean
  canvasMetadataEqual: boolean
}

// Structural deep equality via canonical JSON. Both sides are produced by the same code
// path so key order is irrelevant; JSON.stringify of canonicalised values is sufficient and
// dependency-free.
function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

// Compare an original definition against its serialise->parse round-trip result, separating
// execution semantics from canvasMetadata (the property the round-trip tests assert).
export function compareRoundTrip(
  original: FlowDefinition,
  roundTripped: FlowDefinition
): RoundTripComparison {
  return {
    semanticsEqual: deepEqual(withoutCanvasMetadata(original), withoutCanvasMetadata(roundTripped)),
    canvasMetadataEqual: deepEqual(original.canvasMetadata ?? null, roundTripped.canvasMetadata ?? null)
  }
}

// One-shot: definition -> YAML -> definition. Used by the round-trip property tests.
export function roundTripDefinition(definition: FlowDefinition): FlowDefinition {
  return parseYamlToFlow(serializeFlowToYaml(definition))
}
