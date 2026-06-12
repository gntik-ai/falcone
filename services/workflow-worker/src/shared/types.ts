/**
 * Shared types for the Falcone DSL interpreter worker.
 *
 * These types are the CONTRACT BOUNDARY consumed by sibling changes:
 *   - the activity catalog (add-flows-activity-catalog / #360) implements `executeTask`
 *     against `ActivityInput` / `ActivityResult` defined here;
 *   - the flow control-plane API (#361) constructs `WorkflowInput` to start runs.
 *
 * The DSL document types mirror services/internal-contracts/src/flow-definition.json
 * (apiVersion v1.0). Full structural + semantic validation is the API's job
 * (flow-definition-validator.mjs, FLW-E codes); the interpreter validates only the
 * minimal shape it needs to walk the graph.
 */

/** ISO-8601 duration string (e.g. "PT2S", "P2D"). */
export type IsoDuration = string;

/** DSL retry policy (flow-definition.json #/definitions/retryPolicy). */
export interface DslRetryPolicy {
  maxAttempts?: number;
  backoffCoefficient?: number;
  initialInterval?: IsoDuration;
  maximumInterval?: IsoDuration;
  nonRetryableErrors?: string[];
  timeouts?: {
    startToClose?: IsoDuration;
    scheduleToClose?: IsoDuration;
    heartbeat?: IsoDuration;
  };
}

export interface BranchArm {
  /** CEL boolean expression. */
  when: string;
  /** Target node id when `when` is truthy. */
  next: string;
}

interface NodeBase {
  id: string;
  name?: string;
}

export interface SequenceNode extends NodeBase {
  type: 'sequence';
  steps: string[];
  next?: string;
}
export interface ParallelNode extends NodeBase {
  type: 'parallel';
  branches: string[];
  next?: string;
}
export interface TaskNode extends NodeBase {
  type: 'task';
  taskType: string;
  input?: Record<string, unknown>;
  retryPolicy?: DslRetryPolicy;
  next?: string;
}
export interface BranchNode extends NodeBase {
  type: 'branch';
  arms: BranchArm[];
  default?: string;
}
export interface WaitNode extends NodeBase {
  type: 'wait';
  duration: IsoDuration;
  next?: string;
}
export interface ApprovalNode extends NodeBase {
  type: 'approval';
  approvers?: string[];
  timeout?: IsoDuration;
  next?: string;
}
export interface SubFlowNode extends NodeBase {
  type: 'sub-flow';
  flowId: string;
  flowVersion: string;
  input?: Record<string, unknown>;
  next?: string;
}

export type FlowNode =
  | SequenceNode
  | ParallelNode
  | TaskNode
  | BranchNode
  | WaitNode
  | ApprovalNode
  | SubFlowNode;

/** A parsed flow definition (flow-definition.json, apiVersion v1.0). */
export interface FlowDefinition {
  apiVersion: string;
  name: string;
  description?: string;
  inputs?: Record<string, unknown>;
  triggers?: unknown[];
  nodes: FlowNode[];
  canvasMetadata?: Record<string, unknown>;
}

/**
 * Tenant-scoped execution envelope carried through every workflow + activity.
 * BaaS isolation rule: every activity invocation MUST be scoped by tenant; the
 * interpreter never invokes an activity without a TenantContext.
 */
export interface TenantContext {
  tenantId: string;
  workspaceId?: string;
  /** The flow this execution belongs to (audit + monitoring correlation). */
  flowId?: string;
  /** The pinned definition version for this execution (version pinning). */
  flowVersion?: string;
  /**
   * Per-execution short-lived credential (change: add-flows-tenancy-isolation-limits). Minted by
   * the control-plane at execution start, scoped to `{ tenantId, workspaceId }`, expiring with the
   * run. A REGISTERED catalog activity validates it (assertExecutionToken) before touching any
   * tenant data store; a missing/expired/cross-tenant token fails the activity non-retryably.
   */
  executionToken?: string;
}

/**
 * Activity input envelope — the #360 activity catalog plug-in contract.
 *
 * `executeTask` (and every catalog task activity) receives exactly this shape:
 *   - `node`       the originating DSL task node (carries id, taskType, input);
 *   - `params`     resolved task parameters (the node's `input`, expression-resolved
 *                  by the interpreter before dispatch);
 *   - `tenant`     the tenant context envelope (isolation boundary);
 *   - `nodeId`     the stable DSL node id — ALSO encoded as the Temporal activityId
 *                  per the node-ID naming convention (see ./naming.ts).
 */
export interface ActivityInput {
  nodeId: string;
  taskType: string;
  node: TaskNode;
  params: Record<string, unknown>;
  tenant: TenantContext;
}

/** Generic activity result. The catalog refines this per task type. */
export interface ActivityResult {
  nodeId: string;
  taskType: string;
  output?: unknown;
}

/** Input for the `evaluateExpression` activity (branch / data-mapping). */
export interface EvaluateExpressionInput {
  nodeId: string;
  expression: string;
  /** The data context the CEL expression is evaluated against. */
  context: Record<string, unknown>;
}

/** Input for the `loadFlowDefinition` activity (load-by-reference path). */
export interface LoadFlowDefinitionInput {
  flowId: string;
  version: string;
  tenant: TenantContext;
}

/**
 * Workflow input — discriminated union (design.md D2):
 *   - inline:           `{ definition, tenant, ... }`           (default hot path)
 *   - load-by-reference: `{ flowId, version, tenant, ... }`     (definition fetched via activity)
 */
export type WorkflowInput = InlineWorkflowInput | ReferenceWorkflowInput;

export interface InlineWorkflowInput {
  definition: FlowDefinition;
  tenant: TenantContext;
  /** Initial state / trigger payload the flow runs against (expression context seed). */
  state?: Record<string, unknown>;
}

export interface ReferenceWorkflowInput {
  flowId: string;
  version: string;
  tenant: TenantContext;
  state?: Record<string, unknown>;
}

export function isReferenceInput(input: WorkflowInput): input is ReferenceWorkflowInput {
  return (
    typeof (input as ReferenceWorkflowInput).flowId === 'string' &&
    typeof (input as ReferenceWorkflowInput).version === 'string' &&
    (input as InlineWorkflowInput).definition === undefined
  );
}

/** Result of a completed interpreter run. */
export interface WorkflowResult {
  status: 'completed';
  flowName: string;
  flowVersion?: string;
  /** Ordered list of node ids visited (monitoring + assertions). */
  trace: string[];
  state: Record<string, unknown>;
}
