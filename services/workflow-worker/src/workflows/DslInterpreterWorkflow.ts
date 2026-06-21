/**
 * DslInterpreterWorkflow — the single generic Temporal workflow that executes any
 * Falcone flow definition (apiVersion v1.0). One workflow TYPE interprets every flow;
 * there is no per-definition code generation (ADR-11 / #356).
 *
 * EVERYTHING in this module runs inside the Temporal deterministic V8 isolate. It uses
 * ONLY Temporal SDK constructs (proxyActivities, sleep, condition, setHandler,
 * executeChild, CancellationScope) and pure helpers from ../shared. There is NO
 * Date.now / Math.random / fetch / I/O here — those would break replay determinism. CEL
 * evaluation is delegated to the `evaluateExpression` ACTIVITY (design.md D4), never run
 * inline, so the expression engine's internals stay off the deterministic path.
 *
 * Node-ID naming convention (design.md D3): every activity is dispatched with
 * `activityId = node.id` (see ../shared/naming.ts) so each ActivityTaskScheduled history
 * event maps back to a canvas node — the normative monitoring contract (#366).
 *
 * DSL → Temporal mapping (flow-definition-mapping.json):
 *   sequence    -> sequential awaits of each step
 *   parallel    -> Promise.all over branch futures
 *   task        -> executeActivity('executeTask', {activityId, retry, timeouts})
 *   branch      -> evaluateExpression activity per arm; route to first truthy arm / default
 *   wait        -> sleep(ISO-8601 duration)  (durable timer)
 *   approval    -> setHandler(signal); condition(signalReceived, timeout) (cancel-safe wait)
 *   sub-flow    -> executeChild(DslInterpreterWorkflow) inside a CancellationScope
 */
import {
  proxyActivities,
  executeChild,
  CancellationScope,
  condition,
  sleep,
  setHandler,
  defineSignal,
  defineQuery,
  ApplicationFailure,
  workflowInfo,
} from '@temporalio/workflow';
import type { Duration } from '@temporalio/common';
import type * as activities from '../activities';
import { activityIdForNode } from '../shared/naming';
import { mapRetryPolicy, mapActivityTimeouts, isoDurationToMs } from '../shared/mapping';
import {
  isReferenceInput,
  type WorkflowInput,
  type WorkflowResult,
  type FlowDefinition,
  type FlowNode,
  type TaskNode,
  type BranchNode,
  type WaitNode,
  type ApprovalNode,
  type SequenceNode,
  type ParallelNode,
  type SubFlowNode,
  type TenantContext,
} from '../shared/types';

/** Default inline-definition payload guard (design.md D2): reject definitions > 3 MB. */
const MAX_INLINE_DEFINITION_BYTES = 3 * 1024 * 1024;

/** Approval signal name (design.md): one channel; payload carries the approving actor. */
export interface ApprovalSignalPayload {
  approved: boolean;
  actor?: string;
  /** Targets a specific approval node when several approvals coexist in one run. */
  nodeId?: string;
}
export const approvalSignal = defineSignal<[ApprovalSignalPayload]>('flowApproval');

/** Query the ordered trace of visited node ids (monitoring / tests). */
export const traceQuery = defineQuery<string[]>('flowTrace');

const { evaluateExpression, loadFlowDefinition } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
});

/**
 * DSL `wait.duration` / `approval.timeout` are ISO-8601 strings (FLW-E008), which the
 * Temporal SDK's `sleep` does NOT accept directly — convert to milliseconds (a valid
 * `Duration`). Pure + deterministic (no host APIs). Values are validated upstream.
 */
function asDuration(iso: string): Duration {
  return isoDurationToMs(iso) as unknown as Duration;
}

/** Index nodes by id for O(1) edge resolution. */
function indexNodes(def: FlowDefinition): Map<string, FlowNode> {
  const byId = new Map<string, FlowNode>();
  for (const node of def.nodes) {
    byId.set(node.id, node);
  }
  return byId;
}

/** Minimal shape validation — full validation is the API's job (flow-definition-validator). */
function assertMinimalShape(def: FlowDefinition): void {
  if (!def || !Array.isArray(def.nodes) || def.nodes.length === 0) {
    throw ApplicationFailure.nonRetryable('flow definition has no nodes', 'InvalidFlowDefinition');
  }
}

export async function DslInterpreterWorkflow(input: WorkflowInput): Promise<WorkflowResult> {
  // --- Resolve + PIN the definition for the life of this run (version pinning) ---------
  // The resolved definition is captured in a local const at workflow start. Publishing a
  // new version later never reaches this closure: nothing re-reads an external store.
  const tenant: TenantContext = input.tenant;
  let definition: FlowDefinition;
  if (isReferenceInput(input)) {
    // Load-by-reference: record the load in history so replay is deterministic.
    definition = await loadFlowDefinition({ flowId: input.flowId, version: input.version, tenant });
  } else {
    // Inline (default hot path). Guard the payload size (Temporal 4 MB limit headroom).
    const sizeBytes = JSON.stringify(input.definition).length;
    if (sizeBytes > MAX_INLINE_DEFINITION_BYTES) {
      throw ApplicationFailure.nonRetryable(
        `inline flow definition is ${sizeBytes} bytes, exceeds ${MAX_INLINE_DEFINITION_BYTES}; use the load-by-reference input`,
        'DefinitionTooLarge',
      );
    }
    definition = input.definition;
  }
  assertMinimalShape(definition);

  // Immutable pinned snapshot. `tenant.flowVersion` (if supplied) is the authoritative
  // run version; otherwise fall back to the definition's apiVersion.
  const pinnedVersion = tenant.flowVersion ?? definition.apiVersion;
  const byId = indexNodes(definition);
  const trace: string[] = [];
  setHandler(traceQuery, () => [...trace]);

  // Per-run expression context: seeded with declared inputs/state, augmented by task output.
  let state: Record<string, unknown> = { ...(input.state ?? {}) };

  // Approval signals delivered before the workflow reaches the approval node are buffered.
  const pendingApprovals = new Map<string, ApprovalSignalPayload>();
  setHandler(approvalSignal, (payload: ApprovalSignalPayload) => {
    pendingApprovals.set(payload.nodeId ?? '__any__', payload);
  });

  // ----- Node executors ---------------------------------------------------------------

  /** Run a node by id; returns the next node id (or undefined to stop). */
  async function runNode(nodeId: string): Promise<string | undefined> {
    const node = byId.get(nodeId);
    if (!node) {
      throw ApplicationFailure.nonRetryable(`unknown node '${nodeId}'`, 'UnknownNode');
    }
    trace.push(node.id);
    switch (node.type) {
      case 'sequence':
        return runSequence(node);
      case 'parallel':
        return runParallel(node);
      case 'task':
        return runTask(node);
      case 'branch':
        return runBranch(node);
      case 'wait':
        return runWait(node);
      case 'approval':
        return runApproval(node);
      case 'sub-flow':
        return runSubFlow(node);
      default: {
        const exhaustive: never = node;
        throw ApplicationFailure.nonRetryable(`unsupported node type for ${(exhaustive as FlowNode).id}`, 'UnsupportedNodeType');
      }
    }
  }

  /** Run a chain of nodes starting at `entryId` until the chain ends. */
  async function runChain(entryId: string | undefined): Promise<void> {
    let cursor: string | undefined = entryId;
    while (cursor) {
      cursor = await runNode(cursor);
    }
  }

  /** sequence: await each declared step in order, then advance to `next`. */
  async function runSequence(node: SequenceNode): Promise<string | undefined> {
    for (const stepId of node.steps) {
      await runChain(stepId);
    }
    return node.next;
  }

  /** parallel: schedule all branches concurrently (Promise.all), then advance. */
  async function runParallel(node: ParallelNode): Promise<string | undefined> {
    await Promise.all(node.branches.map((branchId) => runChain(branchId)));
    return node.next;
  }

  /**
   * task: dispatch the `executeTask` activity with the node-ID naming convention and the
   * per-task RetryPolicy / timeouts mapped VERBATIM from the DSL.
   */
  async function runTask(node: TaskNode): Promise<string | undefined> {
    const retry = mapRetryPolicy(node.retryPolicy);
    const timeouts = mapActivityTimeouts(node.retryPolicy);
    // A fresh proxy per node carries this node's activityId + retry/timeout options. When
    // no DSL retryPolicy is given, `retry` is undefined → SDK default retry policy applies.
    const taskActivities = proxyActivities<typeof activities>({
      activityId: activityIdForNode(node.id),
      startToCloseTimeout: timeouts.startToCloseTimeout ?? '1 minute',
      ...(timeouts.scheduleToCloseTimeout ? { scheduleToCloseTimeout: timeouts.scheduleToCloseTimeout } : {}),
      ...(timeouts.heartbeatTimeout ? { heartbeatTimeout: timeouts.heartbeatTimeout } : {}),
      ...(retry ? { retry } : {}),
    });
    const result = await taskActivities.executeTask({
      nodeId: node.id,
      taskType: node.taskType,
      node,
      params: { ...(node.input ?? {}) },
      tenant,
    });
    state = { ...state, [node.id]: result.output };
    return node.next;
  }

  /**
   * branch: evaluate each arm's CEL condition (delegated to the evaluateExpression
   * activity) in order; route to the first truthy arm, else the default arm.
   */
  async function runBranch(node: BranchNode): Promise<string | undefined> {
    for (const arm of node.arms) {
      const outcome = await evaluateExpression({ nodeId: node.id, expression: arm.when, context: state });
      if (outcome) {
        return arm.next;
      }
    }
    if (node.default) {
      return node.default;
    }
    // No arm matched and no default → terminate this chain deterministically.
    return undefined;
  }

  /** wait: durable Temporal timer for the ISO-8601 duration; survives worker restarts. */
  async function runWait(node: WaitNode): Promise<string | undefined> {
    await sleep(asDuration(node.duration));
    return node.next;
  }

  /**
   * approval: block on the approval signal; race signal receipt against an optional
   * timeout timer. On signal → advance on `next`. On timeout → advance on `next` too,
   * recording the timeout outcome in state for downstream branch routing.
   */
  async function runApproval(node: ApprovalNode): Promise<string | undefined> {
    const key = node.id;
    const isResolved = () => pendingApprovals.has(key) || pendingApprovals.has('__any__');

    if (node.timeout) {
      // `condition(predicate, timeout)` is Temporal's built-in timed wait: it resolves
      // `true` when the approval signal arrives and `false` when the timeout fires, and it
      // manages + cleans up the durable timer itself (deterministic on replay). Crucially —
      // unlike a hand-rolled `CancellationScope.cancellable(...).catch(...)` race — it does
      // NOT swallow an EXTERNAL workflow cancellation: an operator `cancel()` that arrives
      // while parked here throws `CancelledFailure`, which propagates so the run ends
      // `Canceled`. We therefore never fabricate a `{timedOut:true}` approval outcome for a
      // cancellation (#678). The state-record below is byte-identical to before for the two
      // legitimate outcomes (signal → `{approved, timedOut:false}`; timeout → `{approved:false,
      // timedOut:true}`); only the cancellation case changes.
      const resolved = await condition(isResolved, asDuration(node.timeout as string));
      const timedOut = !resolved;
      const payload = pendingApprovals.get(key) ?? pendingApprovals.get('__any__');
      state = {
        ...state,
        [node.id]: { approved: !timedOut && (payload?.approved ?? true), timedOut, actor: payload?.actor },
      };
    } else {
      await condition(isResolved);
      const payload = pendingApprovals.get(key) ?? pendingApprovals.get('__any__');
      state = { ...state, [node.id]: { approved: payload?.approved ?? true, timedOut: false, actor: payload?.actor } };
    }
    return node.next;
  }

  /**
   * sub-flow: start a child DslInterpreterWorkflow inside a CancellationScope so parent
   * cancellation propagates to the child. The child definition is resolved by REFERENCE
   * (flowId + flowVersion) — the child run loads + pins its own definition, preserving
   * version pinning across the boundary.
   */
  async function runSubFlow(node: SubFlowNode): Promise<string | undefined> {
    await CancellationScope.cancellable(async () => {
      const childResult = await executeChild(DslInterpreterWorkflow, {
        workflowId: `${workflowInfo().workflowId}-${node.id}`,
        args: [
          {
            flowId: node.flowId,
            version: node.flowVersion,
            tenant: { ...tenant, flowId: node.flowId, flowVersion: node.flowVersion },
            state: { ...(node.input ?? {}) },
          },
        ],
      });
      state = { ...state, [node.id]: childResult.state };
    });
    return node.next;
  }

  // ----- Walk from the root (first declared node = the DSL entry point) ----------------
  await runChain(definition.nodes[0]?.id);

  return {
    status: 'completed',
    flowName: definition.name,
    flowVersion: pinnedVersion,
    trace,
    state,
  };
}
