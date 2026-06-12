// EPHEMERAL SPIKE — not production code.
// Workflow bundle for Spike A. Everything in this module runs inside the Temporal
// deterministic V8 isolate (no Node built-ins, no real timers, no I/O). The expression
// engine is imported here so the bundler + sandbox restrictions are exercised for real.
import { proxyActivities } from '@temporalio/workflow';

// --- Expression engine probes (run inside the sandbox) -----------------------------------
// Imported eagerly so bundling pulls them into the workflow bundle and we learn at
// build/run time whether each survives the isolate.
import { evaluate as celEvaluate } from 'cel-js';
import jsonata from 'jsonata';

const { flakyCharge, slowStep } = proxyActivities({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3 },
});

// Probe workflow: prove `cel-js` can evaluate inside the sandbox.
export async function celProbe(input) {
  // cel-js evaluate(expr, context) -> boolean/value, pure & synchronous.
  return celEvaluate('amount > 100', { amount: input.amount });
}

// Probe workflow: prove `jsonata` can evaluate inside the sandbox.
export async function jsonataProbe(input) {
  const expr = jsonata('amount > 100');
  // jsonata evaluate is async (returns a Promise) but performs no I/O for pure expressions.
  return await expr.evaluate({ amount: input.amount });
}

// --- Generic interpreter workflow --------------------------------------------------------
// Receives the PARSED flow definition + initial state as workflow INPUT (definition-passing
// strategy D3). Walks nodes deterministically; branch conditions evaluated by CEL.
function indexNodes(def) {
  const byId = {};
  for (const node of def.nodes) byId[node.id] = node;
  return byId;
}

export async function interpreterWorkflow({ definition, state, runKey }) {
  const byId = indexNodes(definition);
  const trace = [];
  let cursor = definition.start;

  while (cursor) {
    const node = byId[cursor];
    if (!node) throw new Error(`unknown node ${cursor}`);
    trace.push(node.id);

    if (node.type === 'start') {
      cursor = node.next;
    } else if (node.type === 'branch') {
      // Deterministic: evaluated purely from recorded workflow state, no I/O.
      const outcome = Boolean(celEvaluate(node.condition, state));
      trace.push(`branch:${node.condition}=>${outcome}`);
      cursor = outcome ? node.onTrue : node.onFalse;
    } else if (node.type === 'task') {
      const result = await flakyCharge({ runKey, node: node.id });
      state = { ...state, [node.id]: result };
      cursor = node.next;
    } else if (node.type === 'slow') {
      const result = await slowStep({ ms: node.ms ?? 8000 });
      state = { ...state, [node.id]: result };
      cursor = node.next;
    } else if (node.type === 'end') {
      cursor = null;
    } else {
      throw new Error(`unknown node type ${node.type}`);
    }
  }

  return { status: 'completed', trace, state };
}
