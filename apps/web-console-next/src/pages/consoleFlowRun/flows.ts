// Flow DSL types for the read-only run canvas (copied from the designer, trimmed to the graph projection).
//
// Mirrors packages/internal-contracts/src/flow-definition.json (apiVersion v1.0). This is the
// console-side view of the shared contract; the AUTHORITATIVE structural + semantic rules stay
// in the contract package (flow-definition.json + flow-definition-validator.mjs), which the
// designer imports directly for client-side validation. Kept intentionally thin: only the fields
// the canvas/property-panels read or write.

export type FlowNodeType =
  | 'sequence'
  | 'parallel'
  | 'task'
  | 'branch'
  | 'wait'
  | 'approval'
  | 'sub-flow'

export interface RetryPolicy {
  maxAttempts?: number
  backoffCoefficient?: number
  initialInterval?: string
  maximumInterval?: string
  nonRetryableErrors?: string[]
}

export interface BranchArm {
  when: string
  next: string
}

export interface FlowNodeBase {
  id: string
  type: FlowNodeType
  name?: string
  next?: string
}

export interface SequenceNode extends FlowNodeBase {
  type: 'sequence'
  steps: string[]
}

export interface ParallelNode extends FlowNodeBase {
  type: 'parallel'
  branches: string[]
}

export interface TaskNode extends FlowNodeBase {
  type: 'task'
  taskType: string
  input?: Record<string, unknown>
  retryPolicy?: RetryPolicy
}

export interface BranchNode extends FlowNodeBase {
  type: 'branch'
  arms: BranchArm[]
  default?: string
}

export interface WaitNode extends FlowNodeBase {
  type: 'wait'
  duration: string
}

export interface ApprovalNode extends FlowNodeBase {
  type: 'approval'
  approvers?: string[]
  timeout?: string
}

export interface SubFlowNode extends FlowNodeBase {
  type: 'sub-flow'
  flowId: string
  flowVersion: string
  input?: Record<string, unknown>
}

export type FlowNode =
  | SequenceNode
  | ParallelNode
  | TaskNode
  | BranchNode
  | WaitNode
  | ApprovalNode
  | SubFlowNode

export interface CanvasNodePosition {
  x: number
  y: number
}

export interface CanvasMetadata {
  nodes?: Record<string, CanvasNodePosition>
  [key: string]: unknown
}

export interface FlowDefinition {
  apiVersion: 'v1.0'
  name: string
  description?: string
  inputs?: Record<string, { type: string; required?: boolean; description?: string; default?: unknown }>
  triggers?: Array<{ kind: string; schedule?: string; path?: string; eventType?: string }>
  nodes: FlowNode[]
  canvasMetadata?: CanvasMetadata
}

// Kept only so the shared node projection keeps its shape; a run view never sets validation errors.
export interface ValidationError {
  code: string
  nodeId: string | null
  message: string
  params?: Record<string, unknown>
}
