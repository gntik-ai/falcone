/**
 * Activity implementations for the DSL interpreter worker.
 *
 * Activities run OUTSIDE the Temporal deterministic workflow sandbox, so they may use
 * non-deterministic host APIs (clock, random, I/O, the CEL engine).
 *
 * `executeTask` is the interpreter's task-dispatch seam (src/shared/types.ts
 * ActivityInput → ActivityResult). This change (add-flows-activity-catalog / #360) wires
 * it to the REAL first-party task-type catalog, which is authored as native ESM `.mjs`
 * modules under ./activities/ (so the unit + black-box suites can import the public
 * surface without a tsc build, and so each activity can import the CommonJS
 * @temporalio/activity package via Node's ESM↔CJS interop). Because this package compiles
 * to CommonJS (a hard Temporal SDK constraint), the catalog is loaded at runtime via a
 * genuine dynamic ESM `import()` that tsc must NOT downlevel into `require()` — see
 * `loadCatalog` below.
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

// Runtime ESM loader. `import()` under `module: CommonJS` is rewritten by tsc to
// `Promise.resolve().then(() => require(...))`, which cannot load an ESM `.mjs`. The
// `new Function` indirection produces a real, un-rewritten dynamic `import()` so the CJS
// worker bundle can load the ESM activity catalog. Memoised — the registry populates once.
const dynamicImport: (spec: string) => Promise<any> = new Function(
  'spec',
  'return import(spec)',
) as (spec: string) => Promise<any>;

let catalogPromise: Promise<any> | undefined;
function loadCatalog(): Promise<any> {
  if (!catalogPromise) {
    catalogPromise = dynamicImport('./catalog.mjs');
  }
  return catalogPromise;
}

/**
 * Inject the platform surfaces + per-execution tenant-scoped credential the catalog
 * activities consume. In the worker process these are resolved from the environment /
 * the tenancy-isolation runtime (#362); the harness/black-box suites inject doubles. Kept
 * as a settable seam so worker.ts (or a test) can provide concrete dependencies without
 * threading them through Temporal's activity registration.
 */
let activityDeps: Record<string, unknown> = {};
export function setActivityDeps(deps: Record<string, unknown>): void {
  activityDeps = deps ?? {};
}

/**
 * Generic task execution seam: dispatch the ActivityInput envelope to the matching catalog
 * activity (db.query / storage.* / functions.invoke / events.publish / http.request /
 * email.send). The ENVELOPE (ActivityInput → ActivityResult) is the stable contract.
 */
export async function executeTask(input: ActivityInput): Promise<ActivityResult> {
  if (!input?.tenant?.tenantId) {
    // Isolation guard: never run a task without a tenant scope.
    throw ApplicationFailure.nonRetryable('executeTask invoked without a tenant context', 'UNAUTHENTICATED');
  }
  const catalog = await loadCatalog();
  return catalog.dispatchTask(input, activityDeps) as Promise<ActivityResult>;
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
