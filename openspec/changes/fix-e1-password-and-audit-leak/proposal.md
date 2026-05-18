## Why

The Mongo admin adapter rejects raw passwords but never emits a `rejected`
audit event, leaving validation failures invisible to audit consumers — and
leaving the raw payload reachable to any caller that logs on validation
failure. From `openspec/audit/cap-e1-mongodb-admin.md`:

- **B3** (`services/adapters/src/mongodb-admin.mjs:1215-1217`) —
  `validateUserRequest` issues a violation when `payload.password` is set, so
  the adapter itself does the right thing. **The risk is narrower than the
  subagent flagged but real**: `buildMongoAdminAdapterCall` returns
  `{ok: false, violations, profile}` early, and a caller that fishes the raw
  `payload` out of the request and logs it (a common but bad pattern) leaks
  the password. The adapter contract should require the violation list to
  redact the offending field, not just refuse it.
- **B4** (`services/adapters/src/mongodb-admin.mjs:1726-1741`) — `adminEvent.outcome`
  is hard-coded `'accepted'`. There is no factory for emitting a `rejected`
  event when validation fails, even though `buildMongoAdminAdapterCall`
  returns `{ok: false, violations}` in that case. Audit pipelines counting
  `mongo.admin.*.accepted` events miss every rejection.
- **G10** — the subagent also noted there is no observable `rejected` event
  shape for validation failures (cross-cutting G-S3.1); same root cause as B4.
- **G11** (cross-cutting G-S2.6) — `payload.password` is rejected unconditionally
  at `:1215-1217`, but the raw payload arrives at the adapter and downstream
  audit/normalisation are only avoided by the early-return branch. A defensive
  redaction at the boundary makes this safer regardless of caller behaviour.

## What Changes

- Redact `payload.password` and `payload.passwordBinding.value` (any literal
  secret) at the top of `buildMongoAdminAdapterCall`, replacing them with a
  sentinel `{__redacted: true, fieldPath: '<dot.path>'}` before validation
  runs. The violation list still references the field path but never carries
  the secret itself.
- Emit a `mongo.admin.<resourceKind>.rejected` audit event with
  `outcome: 'rejected'`, the violation list, and the redacted payload shape
  when `validateMongoAdminRequest` returns violations.
- Mirror this in the façade contract so the `mongoAdminEventContract` advertises
  `outcome ∈ {accepted, rejected}`.
- Add a unit test that calls `buildMongoAdminAdapterCall` with
  `payload.password = 'plaintext'` and asserts both (a) violation rejection and
  (b) the returned `{rejected, payload}` carries the redacted sentinel.

## Capabilities

### Modified Capabilities

- `data-services`: Mongo admin adapter audit-envelope rejection contract and
  payload redaction.

## Impact

- **Affected code**: `services/adapters/src/mongodb-admin.mjs` (top of
  `buildMongoAdminAdapterCall`, `adminEvent` factory, contract schema),
  `apps/control-plane/openapi/families/mongo.openapi.json` (event outcome
  enum), `apps/control-plane/src/mongo-admin.mjs` (re-export of event
  contract).
- **Migration required**: none (validator + audit-envelope logic).
- **Breaking changes**: audit consumers MUST be prepared to see
  `mongo.admin.*.rejected` events; consumers that only filter on `.accepted`
  will now miss visibility into rejections (intended outcome — they should
  subscribe to both).
- **Out of scope**: switching the password contract to require a binding
  secret reference (B15 — needs verification); the rejection of raw
  `password` is preserved.
