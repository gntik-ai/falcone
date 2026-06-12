// Client-side semantic validation for the flow designer (change: add-console-flow-designer).
//
// Thin wrapper around the SHARED validator from @in-falcone/internal-contracts
// (flow-definition-validator.mjs) so the canvas runs the IDENTICAL FLW-E001…FLW-E009
// rule set (and identical messages) as the server's validate/publish endpoints.
// No rule is re-implemented here; this module only adapts shapes for the canvas:
// graph state -> ValidationError[] -> per-node Map for `data.validationErrors`.

import {
  defaultExpressionEngine,
  validateFlowDefinition
} from '@in-falcone/internal-contracts/src/flow-definition-validator.mjs'

import type { FlowCanvasEdge, FlowCanvasNode } from '@/components/flows/flowGraphModel'
import { nodesToDefinition } from '@/components/flows/flowGraphModel'
import type { FlowDefinition, ValidationError } from '@/types/flows'

export interface SemanticValidationOptions {
  // Known task types (descriptor ids) for FLW-E006; omitted -> rule not enforced.
  taskTypeCatalog?: Iterable<string>
}

// Validate a DSL definition. Returns the node-scoped error list (nodeId may be null for
// flow-level findings such as cron triggers).
export function validateFlowSemantics(
  definition: FlowDefinition,
  options: SemanticValidationOptions = {}
): ValidationError[] {
  const { errors } = validateFlowDefinition(definition, {
    taskTypeCatalog: options.taskTypeCatalog
  })
  return errors
}

// Validate the live canvas graph by first projecting it back to the DSL (the same
// projection used on save, so what is validated is exactly what would be persisted).
export function validateCanvasGraph(
  base: FlowDefinition,
  nodes: FlowCanvasNode[],
  edges: FlowCanvasEdge[],
  options: SemanticValidationOptions = {}
): ValidationError[] {
  return validateFlowSemantics(nodesToDefinition(base, nodes, edges), options)
}

// Distribute errors per node for the `data.validationErrors` prop. Errors without a
// nodeId (flow-level) are NOT included here; they belong in the Problems panel only.
export function groupErrorsByNode(errors: ValidationError[]): Map<string, ValidationError[]> {
  const byNode = new Map<string, ValidationError[]>()
  for (const error of errors) {
    if (!error.nodeId) continue
    const list = byNode.get(error.nodeId) ?? []
    list.push(error)
    byNode.set(error.nodeId, list)
  }
  return byNode
}

// Synchronous expression syntax check (FLW-E005) using the SAME engine (CEL via cel-js)
// the shared validator uses, for inline property-panel feedback.
export function isExpressionParseable(expression: string): boolean {
  if (typeof expression !== 'string' || expression.trim().length === 0) return false
  return defaultExpressionEngine.parse(expression).ok
}
