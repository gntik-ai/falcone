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
 * Load-by-reference resolver (design.md D2): resolve a flow REFERENCE (`flowId` + `version`)
 * to its actual PUBLISHED definition, scoped to the caller's tenant + workspace, and return
 * it. This is the seam the `sub-flow` DSL node depends on: `DslInterpreterWorkflow.runSubFlow`
 * starts the child by reference, and the child resolves its definition here (#679). The result
 * is recorded in Temporal history, which is what makes the reference path replay-deterministic.
 *
 * The actual store read is the injected `activityDeps.loadFlowDefinition` dependency
 * (worker-deps.mjs::createFlowDefinitionLoader), which reads the immutable `flow_versions`
 * snapshot under the tenant's RLS context. Scoping uses `input.tenant` (the TenantContext) —
 * NOT any caller-supplied scope — so a cross-tenant / foreign-workspace reference resolves to
 * no row and FAILS the run (tenant isolation preserved). An unresolvable reference NEVER
 * substitutes a placeholder definition (the prior stub did, which silently completed the
 * parent on a fabricated `noop` child — the #679 defect).
 */
export async function loadFlowDefinition(input: LoadFlowDefinitionInput): Promise<FlowDefinition> {
  const loader = activityDeps.loadFlowDefinition as
    | ((args: {
        tenantId: string;
        workspaceId?: string;
        flowId: string;
        version: number;
      }) => Promise<unknown>)
    | undefined;
  if (typeof loader !== 'function') {
    // Never fall back to a placeholder: an unwired loader is an operational fault, not a
    // resolvable flow. Failing non-retryably surfaces it instead of silently running a noop.
    throw ApplicationFailure.nonRetryable(
      'flow definition loader not wired',
      'CAPABILITY_UNAVAILABLE',
    );
  }

  const tenantId = input.tenant?.tenantId;
  if (!tenantId) {
    throw ApplicationFailure.nonRetryable(
      'loadFlowDefinition invoked without a tenant context',
      'UNAUTHENTICATED',
    );
  }

  // flow_versions.version is an INTEGER column; coerce + validate so a malformed reference
  // fails fast rather than silently matching no row (or worse, a NaN parameter).
  const version = Number(input.version);
  if (!Number.isInteger(version) || version <= 0) {
    throw ApplicationFailure.nonRetryable(
      `referenced flow version '${input.version}' is not a positive integer`,
      'InvalidFlowVersion',
      input.flowId,
    );
  }

  const definition = (await loader({
    tenantId,
    workspaceId: input.tenant?.workspaceId,
    flowId: input.flowId,
    version,
  })) as FlowDefinition | null | undefined;

  if (definition == null) {
    // Scenario B: missing / foreign-scope reference → fail the parent (executeChild propagates
    // the child failure), NOT a silent placeholder completion.
    throw ApplicationFailure.nonRetryable(
      `referenced flow ${input.flowId}@${version} not found in this workspace`,
      'FlowDefinitionNotFound',
      input.flowId,
    );
  }

  // Minimal shape check (full validation is the API's job): the interpreter needs a non-empty
  // node graph to walk. A stored row with no nodes is a corrupt/unrunnable definition.
  if (!Array.isArray((definition as FlowDefinition).nodes) || (definition as FlowDefinition).nodes.length === 0) {
    throw ApplicationFailure.nonRetryable(
      `referenced flow ${input.flowId}@${version} has no nodes`,
      'InvalidFlowDefinition',
      input.flowId,
    );
  }

  return definition as FlowDefinition;
}
