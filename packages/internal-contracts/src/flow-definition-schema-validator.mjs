/**
 * Structural (JSON Schema) validator for the Falcone flow DSL.
 *
 * The semantic validator (flow-definition-validator.mjs) deliberately does NOT enforce structural
 * rules (apiVersion enum, required fields, node-type enum, `additionalProperties:false`) — those are
 * the JSON Schema's job, and "Callers typically run JSON Schema first, then this validator." This
 * module is that JSON Schema step, shared so the control-plane validate/create/publish path and the
 * console editors run the identical structural rules instead of each re-compiling AJV (or, as in the
 * defect #625, skipping the structural step entirely so a task node with `params`/`parameters`
 * instead of `input` was accepted at create — then failed confusingly at runtime).
 *
 * Returns the same shape as validateFlowDefinition: `{ ok, errors }`. Structural violations carry the
 * stable code `FLW-E000` (the JSON-Schema layer) with the offending instance path + message, so the
 * control-plane can distinguish a schema violation (400) from a semantic one (FLW-E001..009 → 422).
 *
 * Node errors are produced by validating each node against the subschema for its DECLARED `type`
 * rather than surfacing the raw `oneOf` cross-branch noise (every node-type branch's failures), so an
 * author who used `params` sees "must NOT have additional properties ('params')", not an irrelevant
 * "must have required property 'steps'" from the sequence-node branch.
 */
import Ajv from 'ajv';
import flowDefinitionSchema from './flow-definition.json' with { type: 'json' };

// `strict:false` matches the repo's existing AJV usage for this draft-07 schema
// (tests/blackbox/flows-dsl-schema.test.mjs); `allErrors:true` so every problem is reported.
const ajv = new Ajv({ strict: false, allErrors: true });
const validateFull = ajv.compile(flowDefinitionSchema);

// node.type → its definition name, so a node can be validated against exactly its branch.
const NODE_TYPE_DEFINITION = {
  sequence: 'sequenceNode',
  parallel: 'parallelNode',
  task: 'taskNode',
  branch: 'branchNode',
  wait: 'waitNode',
  approval: 'approvalNode',
  'sub-flow': 'subFlowNode',
};
const NODE_TYPES = Object.keys(NODE_TYPE_DEFINITION);
const nodeValidators = Object.fromEntries(
  Object.entries(NODE_TYPE_DEFINITION).map(([type, def]) => [
    type,
    // Reuse the schema's own definitions so the subschema's $refs (nodeId, retryPolicy, …) resolve.
    ajv.compile({ $id: `flow-node-${def}`, definitions: flowDefinitionSchema.definitions, $ref: `#/definitions/${def}` }),
  ]),
);

/** The structural-violation error code (the JSON-Schema layer, distinct from FLW-E001..009). */
export const FLOW_SCHEMA_ERROR_CODE = 'FLW-E000';

function describe(instancePath, e) {
  const where = instancePath || '(root)';
  const extra = e.params?.additionalProperty
    ? ` ('${e.params.additionalProperty}')`
    : e.params?.missingProperty
      ? ` ('${e.params.missingProperty}')`
      : '';
  return `${where} ${e.message}${extra}`.trim();
}

/**
 * Validate a flow definition object against the published DSL JSON Schema.
 * @param {unknown} definition
 * @returns {{ ok: boolean, errors: Array<{ code: string, nodeId: string|null, path: string, message: string }> }}
 */
export function validateFlowDefinitionSchema(definition) {
  if (validateFull(definition)) return { ok: true, errors: [] };

  const errors = [];
  const push = (path, nodeId, message) => errors.push({ code: FLOW_SCHEMA_ERROR_CODE, nodeId, path, message });

  // Top-level (non-node-internal) errors: missing apiVersion/name/nodes, root additionalProperties,
  // bad apiVersion enum, nodes minItems, etc. Skip the raw `/nodes/<i>` oneOf noise — clean per-node
  // errors are produced below.
  for (const e of validateFull.errors ?? []) {
    if (/^\/nodes\/\d+/.test(e.instancePath)) continue;
    push(e.instancePath || '/', null, describe(e.instancePath, e));
  }

  // Per-node errors against the node's DECLARED type subschema.
  if (Array.isArray(definition?.nodes)) {
    definition.nodes.forEach((node, i) => {
      const base = `/nodes/${i}`;
      const nodeId = typeof node?.id === 'string' ? node.id : null;
      const type = node?.type;
      const validate = NODE_TYPES.includes(type) ? nodeValidators[type] : null;
      if (!validate) {
        push(`${base}/type`, nodeId, `${base}/type must be one of: ${NODE_TYPES.join(', ')}`);
        return;
      }
      if (!validate(node)) {
        for (const e of validate.errors ?? []) {
          push(`${base}${e.instancePath}`, nodeId, describe(`${base}${e.instancePath}`, e));
        }
      }
    });
  }

  // Dedup by message (stable order).
  const seen = new Set();
  const deduped = errors.filter((e) => (seen.has(e.message) ? false : seen.add(e.message)));
  return { ok: false, errors: deduped.length > 0 ? deduped : errors };
}
