// Semantic-validation Web Worker (change: add-console-flow-yaml-editor).
//
// Runs the FLW-E001…FLW-E009 rule set off the main thread so cycle detection (FLW-E002,
// O(n+e)) never janks Monaco's change handler on large flows. The worker is a thin transport
// around the pure `runFlowSemantics` core: it receives the editor's YAML (plus the optional
// task-type catalog for FLW-E006) via postMessage and replies with line-anchored markers.
//
// Wired by FlowYamlEditor with:
//   new Worker(new URL('./semantic-worker.ts', import.meta.url), { type: 'module' })
// so Vite emits it as a resolvable, hashed module worker in production builds.

import { runFlowSemantics, type SemanticRequest, type SemanticResult } from '@/lib/flows/semantic-validation-core'

export interface SemanticWorkerRequest extends SemanticRequest {
  // Correlation id so a stale (out-of-order) response can be discarded by the host.
  requestId: number
}

export interface SemanticWorkerResponse extends SemanticResult {
  requestId: number
}

// `self` is the DedicatedWorkerGlobalScope at runtime; typed loosely to avoid pulling the
// WebWorker lib into the app tsconfig.
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<SemanticWorkerRequest>) => void) | null
  postMessage: (message: SemanticWorkerResponse) => void
}

ctx.onmessage = (event: MessageEvent<SemanticWorkerRequest>) => {
  const { requestId, yaml, taskTypeCatalog } = event.data
  const result = runFlowSemantics({ yaml, taskTypeCatalog })
  ctx.postMessage({ requestId, ...result })
}
