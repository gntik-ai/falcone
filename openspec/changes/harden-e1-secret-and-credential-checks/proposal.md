## Why

The Mongo admin adapter constructs credential bindings without verifying the
referenced secret, accepts quota decisions without post-commit re-check, and
normalises identifiers without re-validating them when called outside the
main entry. From `openspec/audit/cap-e1-mongodb-admin.md`:

- **B10** (`services/adapters/src/mongodb-admin.mjs:342`) —
  `adminCredentialBinding.secretRef` is constructed as the string
  `secret://${serviceAccountRef}/active` with no check that the secret
  actually exists in the secret store. The adapter accepts arbitrary
  `serviceAccountRef` values and ships them downstream; the executor finds
  out only at run time.
- **B12** (`services/adapters/src/mongodb-admin.mjs:944-954`) — quota checks
  fire pre-create with no post-commit re-check. Two concurrent
  `create_database` requests that both pass the quota check in this adapter
  rely entirely on the executor to serialise; the adapter does nothing to
  warn the executor that this race exists.
- **B13** (`services/adapters/src/mongodb-admin.mjs:256-258`) — `normalizeName`
  trims input but does not validate it. If `normalizeMongoAdminResource` is
  called outside `validateMongoAdminRequest` (e.g., by a consumer reusing the
  normaliser), names with invalid characters survive normalisation and reach
  the audit envelope.

## What Changes

- Add a `secretRefValidator` injection point on the adapter (defaulting to
  a fast in-memory check against a configured prefix allowlist; real check
  done by executor). Calls to `buildAdminCredentialBinding` reject with
  `MONGO_SECRET_REF_INVALID` when the secret reference does not start with
  one of the configured allowed schemes or has a known-bad shape.
- Stamp a `quotaDecisionId` on every adapter call envelope and require the
  executor (via contract) to revalidate against `pg_*_quotas` /
  `mongo_quotas` inside the same transaction as the resource mutation; the
  adapter emits `preExecutionWarnings` carrying `'quota_race_possible'` so
  the executor knows it MUST re-check.
- Make `normalizeName` call the same name-regex validator used by the
  per-resource validators; throw `MONGO_NAME_INVALID` on mismatch so reuse
  outside `validateMongoAdminRequest` is safe.

## Capabilities

### Modified Capabilities

- `data-services`: Mongo admin secret-reference validation, quota
  race-window contract with the executor, and `normalizeName` safety
  guarantees.

## Impact

- **Affected code**: `services/adapters/src/mongodb-admin.mjs`
  (`buildAdminCredentialBinding`, `normalizeName`, per-resource validators
  pre-create quota checks), `apps/control-plane/openapi/families/mongo.openapi.json`
  (new `quotaDecisionId` field on the adapter-call envelope).
- **Migration required**: none.
- **Breaking changes**: callers that previously passed arbitrary
  `serviceAccountRef` will start receiving `MONGO_SECRET_REF_INVALID` when
  the scheme is unknown; consumers reusing `normalizeName` outside the main
  validator MUST be prepared for throws.
- **Out of scope**: implementing the executor-side re-check (B12) — only
  the contract surface and warning are added here; the actual transactional
  re-check lives in the executor service.
