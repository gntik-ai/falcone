/**
 * Black-box regression suite for spec change fix-666-control-plane-null-body-400
 * (GitHub issue #666, P18 error-semantics · capability control-plane-runtime).
 *
 * Defect (reproduced on live kind head-20260620): a syntactically-valid JSON literal `null` request
 * body on a MUTATING control-plane route returned HTTP 500
 *   { code: "CONTROL_PLANE_ERROR", message: "Internal server error" }
 * instead of a clean 400. Root cause: the server.mjs parse seam did `JSON.parse(rawBody)` and used the
 * result as `body`; `JSON.parse('null')` -> `null`, which was dispatched to a handler (e.g.
 * b-handlers.mjs::createTenant -> `body.displayName`) that derefs a field on `null` -> TypeError ->
 * caught by the top-level catch -> 500. The same happens for a top-level array / scalar.
 *
 * Fix: the parse seam now delegates to apps/control-plane/request-body.mjs::normalizeJsonBody,
 * which — after a successful JSON.parse — rejects any body that is NOT a plain object (`null`, array,
 * scalar) with a structured 400 VALIDATION_ERROR, BEFORE handler dispatch. This is uniform across both
 * dispatch paths (local handlers + the /repo action loader) and ALL mutating routes, because every
 * route's body flows through this single seam. The existing INVALID_JSON (unparseable) and empty-body
 * ({}) behaviours are preserved, and the binary/opaque (non-JSON content-type) path never reaches here.
 *
 * This suite drives the REAL parse-seam function the server runs verbatim (server.mjs imports the same
 * normalizeJsonBody), the established way the kind control-plane is unit-tested without booting the
 * server or a DB (cf. kind-control-plane-multirealm-jwt.test.mjs importing jwt-verify.mjs). The bytes
 * used are exactly what an HTTP client would send on POST /v1/tenants and POST
 * /v1/tenants/{id}/workspaces.
 *
 * Acceptance criteria (issue Requirement + Scenario):
 *   The system SHALL return 400 with a structured { code, message } for a request body that parses to
 *   a non-object (null, array, or scalar), consistent with `{}` (400 VALIDATION_ERROR) and `{bad`
 *   (400 INVALID_JSON). A malformed body MUST NOT produce a 500.
 *   Scenario: WHEN a mutating control-plane request carries the body `null` THEN the response is 400
 *   with a structured error, not 500.
 *
 * Scenario coverage:
 *   bbx-666-01  body `null`  -> 400 VALIDATION_ERROR, structured {code,message}, NOT 500 (the Scenario)
 *   bbx-666-02  body `[]`    -> 400 VALIDATION_ERROR (top-level array rejected)
 *   bbx-666-03  body `false` -> 400 VALIDATION_ERROR (scalar rejected); `42`, `"x"` too
 *   bbx-666-04  body `{}`    -> ok, passes through (handler then emits its own 400; seam does NOT 400)
 *   bbx-666-05  body `{bad`  -> 400 INVALID_JSON (unparseable unchanged)
 *   bbx-666-06  empty body   -> ok, body == {} (no-payload path unchanged)
 *   bbx-666-07  a populated object body passes through unchanged
 *   bbx-666-08  the rejected 400 NEVER carries a 500-shaped code, and the result models a 400 not a 500
 *   bbx-666-09  the seam is byte-identical for a SECOND mutating route's payload (route-agnostic)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeJsonBody } from '../../apps/control-plane/request-body.mjs';

// The exact raw bytes an HTTP client sends as the request body, as the server reads them (a Buffer).
const raw = (s) => Buffer.from(s, 'utf8');

// A structured client error: a 400 with a non-empty {code, message}, and no 5xx-shaped code/message.
function assertStructured400(result) {
  assert.equal(result.ok, false, 'a malformed body is rejected (not ok)');
  assert.equal(result.statusCode, 400, 'a malformed body is a 400, never a 500');
  assert.ok(result.error && typeof result.error === 'object', 'carries a structured error object');
  assert.equal(typeof result.error.code, 'string');
  assert.ok(result.error.code.length > 0, 'error.code is non-empty');
  assert.equal(typeof result.error.message, 'string');
  assert.ok(result.error.message.length > 0, 'error.message is non-empty');
  // The 500 leak this fixes must never appear on the rejection path.
  assert.notEqual(result.error.code, 'CONTROL_PLANE_ERROR', 'must NOT be the 500 code');
  assert.notEqual(result.error.message, 'Internal server error', 'must NOT be the 500 message');
}

// -------------------------------------------------------------------------
// bbx-666-01: the core Scenario — body `null` is a clean 400, not a 500.
// -------------------------------------------------------------------------
test('bbx-666-01: a `null` body on a mutating route is a structured 400 VALIDATION_ERROR, not a 500 (Scenario)', () => {
  const result = normalizeJsonBody(raw('null'));
  assertStructured400(result);
  assert.equal(result.error.code, 'VALIDATION_ERROR', 'a non-object body reuses VALIDATION_ERROR, consistent with `{}`');
  assert.equal(result.error.message, 'Request body must be a JSON object');
});

// -------------------------------------------------------------------------
// bbx-666-02: a top-level array is rejected (no route consumes a top-level array body).
// -------------------------------------------------------------------------
test('bbx-666-02: a `[]` (top-level array) body is a structured 400 VALIDATION_ERROR', () => {
  const result = normalizeJsonBody(raw('[]'));
  assertStructured400(result);
  assert.equal(result.error.code, 'VALIDATION_ERROR');
  // A non-empty array is rejected too (not just the empty one).
  const result2 = normalizeJsonBody(raw('[{"a":1}]'));
  assertStructured400(result2);
});

// -------------------------------------------------------------------------
// bbx-666-03: a scalar body is rejected (boolean / number / string).
// -------------------------------------------------------------------------
test('bbx-666-03: scalar bodies (`false`, `42`, `"x"`) are each a structured 400 VALIDATION_ERROR', () => {
  for (const literal of ['false', 'true', '42', '0', '"x"', '""']) {
    const result = normalizeJsonBody(raw(literal));
    assertStructured400(result);
    assert.equal(result.error.code, 'VALIDATION_ERROR', `${literal} -> VALIDATION_ERROR`);
  }
});

// -------------------------------------------------------------------------
// bbx-666-04: `{}` passes the seam (so the handler can emit its own 400). The seam must NOT reject it.
// -------------------------------------------------------------------------
test('bbx-666-04: an empty object `{}` passes the seam unchanged (handler owns its 400)', () => {
  const result = normalizeJsonBody(raw('{}'));
  assert.equal(result.ok, true, '`{}` is a valid object body — the seam does not 400 it');
  assert.deepEqual(result.body, {}, 'the dispatched body is the empty object');
});

// -------------------------------------------------------------------------
// bbx-666-05: unparseable bytes stay 400 INVALID_JSON (unchanged).
// -------------------------------------------------------------------------
test('bbx-666-05: unparseable bytes `{bad` stay 400 INVALID_JSON (unchanged)', () => {
  const result = normalizeJsonBody(raw('{bad'));
  assertStructured400(result);
  assert.equal(result.error.code, 'INVALID_JSON', 'malformed JSON keeps its distinct code');
  assert.equal(result.error.message, 'Body is not valid JSON');
});

// -------------------------------------------------------------------------
// bbx-666-06: an empty body (no payload) is unchanged — body defaults to {}.
// -------------------------------------------------------------------------
test('bbx-666-06: an empty body is the no-payload case -> ok with body {}', () => {
  const result = normalizeJsonBody(raw(''));
  assert.equal(result.ok, true);
  assert.deepEqual(result.body, {}, 'an empty body dispatches as {} (unchanged behaviour)');
});

// -------------------------------------------------------------------------
// bbx-666-07: a populated object body passes through with its fields intact.
// -------------------------------------------------------------------------
test('bbx-666-07: a populated object body passes through unchanged', () => {
  const result = normalizeJsonBody(raw('{"displayName":"Acme","slug":"acme","nested":{"roles":["a"]}}'));
  assert.equal(result.ok, true);
  assert.deepEqual(result.body, { displayName: 'Acme', slug: 'acme', nested: { roles: ['a'] } });
});

// -------------------------------------------------------------------------
// bbx-666-08: the rejection models a 400, never a 500, and never leaks the 500 code/message.
// -------------------------------------------------------------------------
test('bbx-666-08: a `null` body never models a 500 (no CONTROL_PLANE_ERROR / Internal server error)', () => {
  const result = normalizeJsonBody(raw('null'));
  assert.equal(result.statusCode, 400);
  assert.ok(result.statusCode < 500, 'a malformed client body is a 4xx, never a 5xx');
  const serialized = JSON.stringify(result);
  assert.equal(/CONTROL_PLANE_ERROR/.test(serialized), false, 'the 500 code must not appear');
  assert.equal(/Internal server error/.test(serialized), false, 'the 500 message must not appear');
});

// -------------------------------------------------------------------------
// bbx-666-09: route-agnostic — the SAME bytes behave the same regardless of route. Because the parse
// seam runs once per request, before route handler dispatch, the result is identical whether the body
// was meant for POST /v1/tenants or POST /v1/tenants/{id}/workspaces (both were confirmed 500 on main).
// -------------------------------------------------------------------------
test('bbx-666-09: the fix is route-agnostic — `null` and a valid workspace body behave the same on a second mutating route', () => {
  // `null` is rejected identically (the seam is reached before any route-specific handler).
  assert.equal(normalizeJsonBody(raw('null')).statusCode, 400);
  // A valid workspace-create body (POST /v1/tenants/{id}/workspaces) passes the seam unchanged.
  const ws = normalizeJsonBody(raw('{"name":"prod","displayName":"Production"}'));
  assert.equal(ws.ok, true);
  assert.deepEqual(ws.body, { name: 'prod', displayName: 'Production' });
});
