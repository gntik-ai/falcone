// Deterministic, lossless YAML serialiser for the flow DSL (change: add-console-flow-yaml-editor).
//
// COMMENT-NORMALISATION POLICY (normative — see workflows spec "Comment-handling policy"):
//   - While the user edits YAML directly, comments live only in the Monaco buffer and are
//     NEVER read by this module; the editor preserves them verbatim for that session.
//   - The moment the document is re-serialised FROM the in-memory graph model — i.e. on the
//     YAML -> canvas -> YAML round-trip — comments are DISCARDED. `serializeFlowToYaml`
//     emits purely from the structured FlowDefinition and carries no CST, so every comment
//     from a previous YAML session is dropped. This is intentional: the graph model is the
//     authority for structure, and re-deriving the text guarantees byte-stable output.
//   `parseYamlToFlow` reads structure only and likewise ignores comments.
//
// DETERMINISM: top-level keys and node keys are emitted in the order declared by the
// versioned JSON Schema (flow-definition.json) `properties` objects; keys not described by
// the schema (free-form `canvasMetadata` children, `input` payloads) are sorted
// alphabetically. `canvasMetadata` is always emitted as the LAST top-level key. The same
// logical graph therefore serialises to a byte-identical string on every call — the
// property the round-trip/determinism tests assert.

// Import the JSON Schema document DIRECTLY (not via the package barrel index.mjs, which has
// readFileSync side effects that break under the bundler/jsdom test environment). The schema
// is the single source of the canonical key order and is also fed to monaco-yaml as an inline
// object (FlowYamlEditor) to avoid CORS-fetching a URI.
import flowDefinitionSchema from '@in-falcone/internal-contracts/src/flow-definition.json' with { type: 'json' }
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import type { FlowDefinition } from '@/types/flows'

type SchemaObject = {
  properties?: Record<string, unknown>
  definitions?: Record<string, SchemaObject>
}

const schema = flowDefinitionSchema as unknown as SchemaObject

// Top-level key order straight from the schema's `properties` insertion order. Frozen so the
// blackbox surface can assert it.
export const FLOW_TOP_LEVEL_KEY_ORDER: readonly string[] = Object.freeze(
  Object.keys(schema.properties ?? {})
)

// Build a per-node-type key order from each `<type>Node` definition in the schema. The schema
// declares one definition per node type (sequenceNode, taskNode, …); union the property names
// in declaration order so a serialised node mirrors the contract's field order.
function buildNodeKeyOrder(): string[] {
  const order: string[] = []
  const seen = new Set<string>()
  const defs = schema.definitions ?? {}
  for (const [name, def] of Object.entries(defs)) {
    if (!name.endsWith('Node')) continue
    for (const key of Object.keys(def.properties ?? {})) {
      if (!seen.has(key)) {
        seen.add(key)
        order.push(key)
      }
    }
  }
  return order
}

const NODE_KEY_ORDER: readonly string[] = Object.freeze(buildNodeKeyOrder())

// Order an object's keys: schema-declared keys first (in `declared` order), then any
// remaining keys alphabetically. Stable for a given input.
function orderKeys(value: Record<string, unknown>, declared: readonly string[]): string[] {
  const present = new Set(Object.keys(value))
  const ordered: string[] = []
  for (const key of declared) {
    if (present.has(key)) {
      ordered.push(key)
      present.delete(key)
    }
  }
  for (const key of [...present].sort()) ordered.push(key)
  return ordered
}

// Recursively rebuild a value with deterministic key order. Arrays keep their order (it is
// execution-significant); plain objects are re-keyed; scalars pass through.
function canonicalize(value: unknown, declared: readonly string[] = []): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item))
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of orderKeys(record, declared)) {
      // `nodes` entries are ordered by the node-key order; everything else falls back to
      // alphabetical (declared=[]). `canvasMetadata` children are intentionally alphabetical.
      const childDeclared = key === '__node__' ? NODE_KEY_ORDER : []
      out[key] = canonicalize(record[key], childDeclared)
    }
    return out
  }
  return value
}

// Apply node-key ordering to each node (canonicalize cannot know the array element is a node
// without a hint, so order nodes explicitly here).
function canonicalNode(node: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of orderKeys(node, NODE_KEY_ORDER)) {
    out[key] = canonicalize(node[key])
  }
  return out
}

// Produce the canonical, deterministic ordered object for a FlowDefinition. `canvasMetadata`
// is forced last by ordering the top-level keys with it appended.
function canonicalDefinition(definition: FlowDefinition): Record<string, unknown> {
  const record = definition as unknown as Record<string, unknown>
  // Top-level order = schema order, but canvasMetadata is always emitted last regardless of
  // where the schema lists it.
  const topOrder = FLOW_TOP_LEVEL_KEY_ORDER.filter((k) => k !== 'canvasMetadata')
  const out: Record<string, unknown> = {}
  const present = new Set(Object.keys(record))
  for (const key of topOrder) {
    if (!present.has(key)) continue
    present.delete(key)
    if (key === 'nodes' && Array.isArray(record.nodes)) {
      out.nodes = (record.nodes as Record<string, unknown>[]).map(canonicalNode)
    } else {
      out[key] = canonicalize(record[key])
    }
  }
  // Any non-schema top-level key (other than canvasMetadata) alphabetically, before metadata.
  for (const key of [...present].filter((k) => k !== 'canvasMetadata').sort()) {
    out[key] = canonicalize(record[key])
  }
  // canvasMetadata strictly last.
  if (present.has('canvasMetadata') && record.canvasMetadata !== undefined) {
    out.canvasMetadata = canonicalize(record.canvasMetadata)
  }
  return out
}

/**
 * Serialise a FlowDefinition graph model to canonical YAML.
 *
 * Deterministic: identical input -> byte-identical output. Discards comments (see policy at
 * the top of this file). `canvasMetadata` is always the last top-level key.
 */
export function serializeFlowToYaml(definition: FlowDefinition): string {
  return stringifyYaml(canonicalDefinition(definition), {
    indent: 2,
    // Stable, comment-free scalar quoting and no document markers for a clean round-trip.
    lineWidth: 0,
    nullStr: 'null'
  })
}

/**
 * Parse a YAML document back into the FlowDefinition graph model.
 *
 * Structure-only: comments and formatting are ignored (policy above). Throws a SyntaxError
 * on syntactically invalid YAML so callers can degrade gracefully without mutating any
 * stored draft.
 */
export function parseYamlToFlow(yaml: string): FlowDefinition {
  let parsed: unknown
  try {
    parsed = parseYaml(yaml)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid YAML'
    throw new SyntaxError(`Flow YAML could not be parsed: ${message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SyntaxError('Flow YAML must describe a mapping at the document root.')
  }
  return parsed as FlowDefinition
}

/** True when the text parses as YAML (syntactic check only — no schema/semantic check). */
export function isParseableYaml(yaml: string): boolean {
  try {
    parseYaml(yaml)
    return true
  } catch {
    return false
  }
}
