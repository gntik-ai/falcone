// Task-type registry for the first-party activity catalog (change:
// add-flows-activity-catalog / #360).
//
// D3: a plain Map initialized from code at module load. The registry is the SINGLE
// authoritative source of task types, consumed by:
//   - DSL validation FLW-E006 (packages/internal-contracts flow-definition-validator),
//     via the exported `taskTypeNames()` (names only — no Temporal dependency);
//   - the future console palette (#363), via `listTaskTypes()` (names + schemas);
//   - the Temporal interpreter's `executeTask` seam, via `resolveActivity(name)`.
//
// REGISTRY ENTRY SHAPE (the cross-change contract — keep stable):
//   {
//     activity:     async (input) => output,   // the Temporal activity implementation
//     inputSchema:  <JSON Schema>,             // input envelope schema (palette + docs)
//     outputSchema: <JSON Schema>,             // output envelope schema
//   }
//
// `resolveActivity` throws a non-retryable UNKNOWN_TASK_TYPE for an unregistered name so a
// definition that slipped past FLW-E006 still fails closed at dispatch time.
import { toNonRetryable } from './errors.mjs';

const registry = new Map();

/**
 * Register a task type. Idempotent for identical re-registration is NOT assumed: a
 * duplicate name throws to surface accidental collisions at load time.
 *
 * @param {string} name e.g. "db.query"
 * @param {{ activity: Function, inputSchema: object, outputSchema: object }} entry
 */
export function registerActivity(name, entry) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('registerActivity: task type name must be a non-empty string');
  }
  if (!entry || typeof entry.activity !== 'function') {
    throw new Error(`registerActivity: entry for "${name}" must include an activity function`);
  }
  if (registry.has(name)) {
    throw new Error(`registerActivity: task type "${name}" is already registered`);
  }
  registry.set(name, {
    activity: entry.activity,
    inputSchema: entry.inputSchema ?? { type: 'object' },
    outputSchema: entry.outputSchema ?? { type: 'object' },
  });
  return entry;
}

/**
 * Resolve a registered task type to its full entry. Unknown name → non-retryable
 * UNKNOWN_TASK_TYPE (fail-closed; mirrors FLW-E006 at the dispatch boundary).
 */
export function resolveActivity(name) {
  const entry = registry.get(name);
  if (!entry) {
    throw toNonRetryable('UNKNOWN_TASK_TYPE', `Unknown task type "${name}"; not present in the task-type registry`);
  }
  return entry;
}

/** True when a task type is registered. */
export function hasTaskType(name) {
  return registry.has(name);
}

/**
 * The set of registered task type names. This is the value the control-plane flows
 * validate endpoint passes as `taskTypeCatalog` to enforce FLW-E006. Names only — pulling
 * this in does NOT require the Temporal SDK at the call site? No: importing this module
 * still loads the activity bindings. For a Temporal-free consumer use ./catalog-names.mjs.
 */
export function taskTypeNames() {
  return [...registry.keys()];
}

/** Names + schemas (no activity functions) for the console palette / docs. */
export function listTaskTypes() {
  return [...registry.entries()].map(([name, entry]) => ({
    name,
    inputSchema: entry.inputSchema,
    outputSchema: entry.outputSchema,
  }));
}

/** Test/diagnostic helper: the underlying map (do not mutate in production code). */
export function _registry() {
  return registry;
}
