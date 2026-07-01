/**
 * Semantic validator for the Falcone flow DSL.
 *
 * This module is the single shared implementation of the semantic rules that JSON
 * Schema cannot express (unique IDs, acyclic graph, resolvable references, parseable
 * CEL expressions, known task types). It is intentionally placed in
 * `@in-falcone/internal-contracts` so the control-plane validate endpoint and the
 * console editors import the identical rule set and the identical stable error codes
 * (`FLW-E001`…`FLW-E009`) — see flow-definition.json and the workflows spec for the
 * normative code↔rule table.
 *
 * Structural validation (apiVersion enum, required fields, node-type enum,
 * additionalProperties:false) is the job of the JSON Schema (flow-definition.json) and
 * is NOT duplicated here. Callers typically run JSON Schema first, then this validator.
 *
 * Engine boundary: expression parsing (FLW-E005) is delegated to an injectable
 * expression engine. The default engine wraps `cel-js` (the engine chosen in ADR-11);
 * a caller may pass `{ expressionEngine }` to swap it (e.g. the validated JSONata
 * fallback) without touching the rule logic.
 *
 * Reference resolution (FLW-E004) and the task-type catalog (FLW-E006) are also
 * injectable seams: when no resolver / catalog is supplied the corresponding rule is a
 * no-op (the contract explicitly scopes FLW-E004 to "when a resolver is provided" and
 * FLW-E006 to "the catalog provided to the validator").
 */

import { parse as celParse } from 'cel-js';

/**
 * Normative code↔rule table. Kept in sync with flow-definition.json and the
 * workflows spec delta. Exported so consumers can render diagnostics catalogs.
 */
export const FLOW_VALIDATION_ERROR_CODES = Object.freeze({
  'FLW-E001': 'Node IDs MUST be unique within the flow document',
  'FLW-E002': 'The node graph MUST be acyclic (no cycle reachable via next, branches, steps, or arm edges)',
  'FLW-E003': 'Every node ID referenced in an edge MUST exist in the nodes array',
  'FLW-E004': "Every sub-flow node's flowId + flowVersion reference MUST be resolvable at validation time when a resolver is provided",
  'FLW-E005': 'Expression strings MUST be parseable by the configured expression engine',
  'FLW-E006': 'Every taskType value MUST exist in the task-type catalog provided to the validator',
  'FLW-E007': 'A cron trigger schedule field MUST be a valid POSIX cron expression (5 or 6 fields)',
  'FLW-E008': "A wait node's duration field MUST be a valid ISO 8601 duration string",
  'FLW-E009': 'A branch node MUST have at least two condition arms or one condition arm plus a default arm'
});

/**
 * Default expression engine: CEL via cel-js (ADR-11). `parse(expr)` returns
 * `{ isSuccess: boolean, errors?: [...] }` for cel-js@0.5.0.
 *
 * @type {{ parse(expression: string): { ok: boolean } }}
 */
export const defaultExpressionEngine = Object.freeze({
  name: 'cel',
  parse(expression) {
    try {
      const result = celParse(expression);
      return { ok: result?.isSuccess === true };
    } catch {
      return { ok: false };
    }
  }
});

const ISO8601_DURATION = /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(?:\.\d+)?S)?)?$/;

function isValidIso8601Duration(value) {
  return typeof value === 'string' && value.length > 0 && ISO8601_DURATION.test(value);
}

function isValidCronExpression(value) {
  if (typeof value !== 'string') return false;
  const fields = value.trim().split(/\s+/).filter(Boolean);
  return fields.length === 5 || fields.length === 6;
}

/**
 * Collect every (sourceNodeId, targetNodeId, edgeKind) edge declared by a node.
 */
function outgoingEdges(node) {
  const edges = [];
  const push = (target, kind) => {
    if (typeof target === 'string' && target.length > 0) {
      edges.push({ target, kind });
    }
  };

  if (typeof node.next === 'string') push(node.next, 'next');

  switch (node.type) {
    case 'sequence':
      for (const step of node.steps ?? []) push(step, 'steps');
      break;
    case 'parallel':
      for (const branch of node.branches ?? []) push(branch, 'branches');
      break;
    case 'branch':
      for (const arm of node.arms ?? []) push(arm?.next, 'arm');
      push(node.default, 'default');
      break;
    default:
      break;
  }

  return edges;
}

function collectExpressions(node) {
  const expressions = [];
  if (node.type === 'branch') {
    for (const arm of node.arms ?? []) {
      if (typeof arm?.when === 'string') {
        expressions.push(arm.when);
      }
    }
  }
  return expressions;
}

function error(code, nodeId, message) {
  return { code, nodeId, message };
}

/**
 * Run the full semantic rule set over a flow definition.
 *
 * @param {object} definition Parsed flow document (already structurally valid, ideally).
 * @param {object} [options]
 * @param {{ parse(expression: string): { ok: boolean } }} [options.expressionEngine]
 *        Expression engine for FLW-E005. Defaults to CEL (cel-js).
 * @param {(ref: { flowId: string, flowVersion: string }) => boolean} [options.resolveSubFlow]
 *        Resolver for FLW-E004. When omitted, FLW-E004 is not enforced.
 * @param {Iterable<string>} [options.taskTypeCatalog]
 *        Known task types for FLW-E006. When omitted, FLW-E006 is not enforced.
 * @returns {{ ok: boolean, errors: Array<{ code: string, nodeId: string|null, message: string }> }}
 */
export function validateFlowDefinition(definition, options = {}) {
  const expressionEngine = options.expressionEngine ?? defaultExpressionEngine;
  const resolveSubFlow = options.resolveSubFlow ?? null;
  const taskTypeCatalog = options.taskTypeCatalog ? new Set(options.taskTypeCatalog) : null;

  const errors = [];

  if (!definition || typeof definition !== 'object' || !Array.isArray(definition.nodes)) {
    // Structural shape is the JSON Schema's responsibility; with nothing to inspect
    // the semantic layer has no rules to run.
    return { ok: true, errors };
  }

  const nodes = definition.nodes;

  // FLW-E001: unique node IDs.
  const seen = new Set();
  const duplicates = new Set();
  for (const node of nodes) {
    const id = node?.id;
    if (typeof id !== 'string') continue;
    if (seen.has(id)) {
      duplicates.add(id);
    }
    seen.add(id);
  }
  for (const id of duplicates) {
    errors.push(error('FLW-E001', id, `ID de nodo duplicado "${id}"; los ID de nodo deben ser únicos dentro del flujo.`));
  }

  const nodeById = new Map();
  for (const node of nodes) {
    if (typeof node?.id === 'string' && !nodeById.has(node.id)) {
      nodeById.set(node.id, node);
    }
  }

  // FLW-E003: every referenced edge target must exist.
  for (const node of nodes) {
    if (typeof node?.id !== 'string') continue;
    for (const { target } of outgoingEdges(node)) {
      if (!nodeById.has(target)) {
        errors.push(
          error('FLW-E003', node.id, `El nodo "${node.id}" referencia el nodo desconocido "${target}".`)
        );
      }
    }
  }

  // FLW-E002: graph must be acyclic. Only traverse edges to existing nodes so that a
  // dangling reference (E003) does not masquerade as a cycle.
  const cycleNodeId = detectCycle(nodes, nodeById);
  if (cycleNodeId) {
    errors.push(error('FLW-E002', cycleNodeId, `El grafo de nodos contiene un ciclo alcanzable desde el nodo "${cycleNodeId}".`));
  }

  // FLW-E009: branch arity.
  for (const node of nodes) {
    if (node?.type !== 'branch') continue;
    const arms = Array.isArray(node.arms) ? node.arms : [];
    const hasDefault = typeof node.default === 'string' && node.default.length > 0;
    const sufficient = arms.length >= 2 || (arms.length >= 1 && hasDefault);
    if (!sufficient) {
      errors.push(
        error('FLW-E009', node.id ?? null, `La rama "${node.id}" necesita al menos dos brazos, o un brazo más una conexión predeterminada.`)
      );
    }
  }

  // FLW-E005: expression strings must parse.
  for (const node of nodes) {
    for (const expression of collectExpressions(node)) {
      const { ok } = expressionEngine.parse(expression);
      if (!ok) {
        errors.push(
          error('FLW-E005', node.id ?? null, `La expresión "${expression}" no puede analizarse con el motor ${expressionEngine.name ?? 'configurado'}.`)
        );
      }
    }
  }

  // FLW-E006: taskType must be in the catalog (when a catalog is provided).
  if (taskTypeCatalog) {
    for (const node of nodes) {
      if (node?.type !== 'task') continue;
      if (typeof node.taskType === 'string' && !taskTypeCatalog.has(node.taskType)) {
        errors.push(
          error('FLW-E006', node.id ?? null, `Tipo de tarea desconocido "${node.taskType}"; no está presente en el catálogo de tipos de tarea.`)
        );
      }
    }
  }

  // FLW-E004: sub-flow references must resolve (when a resolver is provided).
  if (resolveSubFlow) {
    for (const node of nodes) {
      if (node?.type !== 'sub-flow') continue;
      const ref = { flowId: node.flowId, flowVersion: node.flowVersion };
      if (!resolveSubFlow(ref)) {
        errors.push(
          error('FLW-E004', node.id ?? null, `La referencia de subflujo ${node.flowId}@${node.flowVersion} no pudo resolverse.`)
        );
      }
    }
  }

  // FLW-E008: wait node duration must be a valid ISO 8601 duration.
  for (const node of nodes) {
    if (node?.type !== 'wait') continue;
    if (!isValidIso8601Duration(node.duration)) {
      errors.push(
        error('FLW-E008', node.id ?? null, `La duración "${node.duration}" del nodo de espera "${node.id}" no es una duración ISO 8601 válida.`)
      );
    }
  }

  // FLW-E007: cron trigger schedule must be a valid POSIX cron expression.
  const triggers = Array.isArray(definition.triggers) ? definition.triggers : [];
  triggers.forEach((trigger, index) => {
    if (trigger?.kind !== 'cron') return;
    if (!isValidCronExpression(trigger.schedule)) {
      errors.push(
        error('FLW-E007', `triggers[${index}]`, `La programación cron "${trigger.schedule}" no es una expresión cron POSIX válida (5 o 6 campos).`)
      );
    }
  });

  return { ok: errors.length === 0, errors };
}

/**
 * Depth-first cycle detection over the node graph. Returns the id of a node that is
 * part of (or leads into) a back-edge cycle, or null when the graph is acyclic.
 * Only edges to existing nodes are followed.
 */
function detectCycle(nodes, nodeById) {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map();
  for (const node of nodes) {
    if (typeof node?.id === 'string') color.set(node.id, WHITE);
  }

  let found = null;

  function visit(id) {
    if (found) return;
    color.set(id, GREY);
    const node = nodeById.get(id);
    for (const { target } of outgoingEdges(node)) {
      if (!nodeById.has(target)) continue;
      const targetColor = color.get(target);
      if (targetColor === GREY) {
        found = target;
        return;
      }
      if (targetColor === WHITE) {
        visit(target);
        if (found) return;
      }
    }
    color.set(id, BLACK);
  }

  for (const node of nodes) {
    if (typeof node?.id !== 'string') continue;
    if (color.get(node.id) === WHITE) {
      visit(node.id);
      if (found) break;
    }
  }

  return found;
}
