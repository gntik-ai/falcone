/**
 * Activity implementations for the DSL interpreter worker.
 *
 * Activities run OUTSIDE the Temporal deterministic workflow sandbox, so they may use
 * non-deterministic host APIs (clock, random, I/O, the CEL engine). This change ships
 * only the HARNESS/STUB activities; the real task catalog is the sibling change
 * add-flows-activity-catalog (#360), which implements `executeTask` against the
 * ActivityInput envelope (src/shared/types.ts).
 */
import { evaluate as celEvaluate } from 'cel-js';
import { ApplicationFailure } from '@temporalio/activity';
import type {
  ActivityInput,
  ActivityResult,
  EvaluateExpressionInput,
  LoadFlowDefinitionInput,
  FlowDefinition,
} from '../shared/types';

/**
 * Generic task execution seam. The #360 catalog replaces this body with the real
 * per-taskType dispatch; the ENVELOPE (ActivityInput → ActivityResult) is the stable
 * contract and must not change here.
 *
 * Stub behaviour: echo the node so harness/real-stack tests can assert dispatch + the
 * node-ID naming convention without a real task catalog.
 */
export async function executeTask(input: ActivityInput): Promise<ActivityResult> {
  if (!input?.tenant?.tenantId) {
    // Isolation guard: never run a task without a tenant scope.
    throw ApplicationFailure.nonRetryable('executeTask invoked without a tenant context', 'MissingTenantContext');
  }
  return {
    nodeId: input.nodeId,
    taskType: input.taskType,
    output: { executed: true, taskType: input.taskType, params: input.params ?? {} },
  };
}

/**
 * Evaluate a CEL boolean/data expression OUTSIDE the workflow sandbox (design.md D4).
 * cel-js is pure + side-effect-free, but delegating keeps any future engine internals
 * (timestamp/random) off the deterministic path.
 *
 * A syntactically invalid expression yields a NON-RETRYABLE failure identifying the
 * offending node id (spec: "Invalid expression fails the workflow task ...").
 */
export async function evaluateExpression(input: EvaluateExpressionInput): Promise<unknown> {
  try {
    return celEvaluate(input.expression, input.context ?? {});
  } catch (err) {
    throw ApplicationFailure.nonRetryable(
      `Invalid expression at node '${input.nodeId}': ${(err as Error)?.message ?? String(err)}`,
      'InvalidExpression',
      input.nodeId,
    );
  }
}

/**
 * Load-by-reference resolver (design.md D2). Real impl (fetch from the flow store,
 * scoped by tenant) is #360/#361; the stub returns a fixed minimal definition so the
 * load-by-reference path is exercisable end-to-end. The result is recorded in Temporal
 * history, which is what makes the reference path replay-deterministic.
 */
export async function loadFlowDefinition(input: LoadFlowDefinitionInput): Promise<FlowDefinition> {
  return {
    apiVersion: 'v1.0',
    name: `${input.flowId}@${input.version}`,
    description: 'stub definition (real resolver: add-flows-activity-catalog #360)',
    nodes: [
      { id: 'loaded-step', type: 'task', taskType: 'noop' },
    ],
  };
}
