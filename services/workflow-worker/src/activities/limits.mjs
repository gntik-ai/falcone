// Payload-size limits for the first-party task-type activity catalog (change:
// add-flows-activity-catalog / #360).
//
// Authoring note (deviation from tasks.md "*.mjs" while keeping intent): the
// workflow-worker package is TypeScript + CommonJS by a hard Temporal SDK constraint
// (see package.json). The activity catalog is authored as native ESM `.mjs` modules so
// the unit + black-box suites (`node --test`, no build step) can import the PUBLIC
// surface directly, and so each activity can `import { ApplicationFailure }` from the
// (CommonJS) `@temporalio/activity` package via Node's ESM↔CJS interop. The TypeScript
// `index.ts` bridges these modules into the Temporal worker registration.
import { toNonRetryable } from './errors.mjs';

// Temporal's recommended blob payload limit is 2 MiB. Inputs and outputs are each capped
// independently; an activity that would otherwise produce a giant blob fails fast rather
// than OOM-ing the worker or being rejected by the Temporal server.
export const MAX_INPUT_BYTES = 2 * 1024 * 1024;
export const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

/**
 * Serialized byte size of a value as JSON (UTF-8). `undefined` serializes to nothing.
 */
export function serializedByteLength(value) {
  if (value === undefined) return 0;
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/**
 * Assert that a value's serialized JSON size is within the given limit.
 *
 * @param {unknown} value  the input or output envelope
 * @param {string}  label  "input" or "output" (used in the error message)
 * @param {number}  [limit] byte cap (defaults to the input limit)
 * @throws non-retryable ApplicationFailure code `PAYLOAD_TOO_LARGE` when oversized
 */
export function assertPayloadSize(value, label, limit = MAX_INPUT_BYTES) {
  const size = serializedByteLength(value);
  if (size > limit) {
    throw toNonRetryable(
      'PAYLOAD_TOO_LARGE',
      `Activity ${label} payload is ${size} bytes which exceeds the ${limit}-byte limit`,
    );
  }
}
