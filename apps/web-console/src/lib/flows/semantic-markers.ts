// FLW-E semantic errors -> editor markers (change: add-console-flow-yaml-editor).
//
// Pure, framework-free mapping so it is testable in isolation and reusable by the semantic
// worker. It takes the shared validator's ValidationError[] (FLW-E001…FLW-E009, identical
// codes/messages as the server) and the current YAML text, and produces line-anchored
// marker descriptors. The line is derived from the YAML document where possible:
//   - errors carrying a real nodeId are anchored to the line of that node's `id:` value;
//   - flow-level errors (nodeId null, or synthetic ids like `triggers[0]`) fall back to the
//     top of the document (line 1) — still surfaced, just not node-anchored.
// The nodeId is always embedded in the marker message so the offending node is identifiable
// even when a precise line cannot be derived.

import { parseDocument, isMap, isScalar } from 'yaml'

import type { ValidationError } from '@/types/flows'

export type MarkerSeverity = 'error' | 'warning'

export interface FlowMarker {
  code: string
  message: string
  nodeId: string | null
  line: number // 1-based; 1 when the line cannot be derived
  column: number // 1-based
  severity: MarkerSeverity
}

// Build a nodeId -> 1-based line index by walking the YAML document's `nodes` sequence and
// reading the line of each node's `id` scalar. Returns an empty map on unparseable YAML so a
// syntax error never blocks the (separately reported) structural diagnostics.
export function buildNodeLineIndex(yaml: string): Map<string, number> {
  const index = new Map<string, number>()
  let doc
  try {
    doc = parseDocument(yaml, { keepSourceTokens: true })
  } catch {
    return index
  }
  if (!doc || doc.errors.length > 0) {
    // Still attempt to read whatever parsed; a partial doc can yield some line hints.
  }
  const root = doc?.contents
  if (!isMap(root)) return index
  const nodesPair = root.items.find((pair) => isScalar(pair.key) && pair.key.value === 'nodes')
  const nodesSeq = nodesPair?.value
  if (!nodesSeq || !('items' in nodesSeq) || !Array.isArray((nodesSeq as { items: unknown[] }).items)) {
    return index
  }
  for (const item of (nodesSeq as { items: unknown[] }).items) {
    if (!isMap(item)) continue
    const idPair = item.items.find((pair) => isScalar(pair.key) && pair.key.value === 'id')
    if (!idPair || !isScalar(idPair.value)) continue
    const id = idPair.value.value
    const range = idPair.value.range
    if (typeof id === 'string' && range) {
      index.set(id, offsetToLine(yaml, range[0]))
    }
  }
  return index
}

// Translate a character offset into a 1-based line number.
function offsetToLine(text: string, offset: number): number {
  let line = 1
  const stop = Math.min(offset, text.length)
  for (let i = 0; i < stop; i += 1) {
    if (text.charCodeAt(i) === 10 /* \n */) line += 1
  }
  return line
}

// Map the shared validator's errors onto line-anchored markers. `yaml` is the current editor
// text; when omitted, every marker falls back to line 1 (nodeId still in the message).
export function toFlowMarkers(errors: ValidationError[], yaml = ''): FlowMarker[] {
  const lineIndex = yaml ? buildNodeLineIndex(yaml) : new Map<string, number>()
  return errors.map((error) => {
    const line = (error.nodeId && lineIndex.get(error.nodeId)) || 1
    const nodeSuffix = error.nodeId ? ` (node "${error.nodeId}")` : ''
    return {
      code: error.code,
      message: `${error.code}: ${error.message}${nodeSuffix}`,
      nodeId: error.nodeId ?? null,
      line,
      column: 1,
      severity: 'error' as const
    }
  })
}
