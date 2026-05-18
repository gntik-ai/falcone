## Why

The storage access-policy evaluation loop in the object-storage adapter terminates
on the first non-null policy source, making workspace and builtin defaults
unreachable whenever a bucket policy exists. From
`openspec/audit/cap-g1-object-storage-adapter.md`:

- **B1** (`services/adapters/src/storage-access-policy.mjs:553-569`) — the
  `for (const entry of orderedPolicies)` loop unconditionally
  `return buildFrozenRecord(...)` inside the body. `orderedPolicies` is built as
  `[SUPERADMIN_OVERRIDE, BUCKET_POLICY, WORKSPACE_DEFAULT, BUILTIN_DEFAULT].filter(...)`.
  If `BUCKET_POLICY` is non-null, the loop returns its decision even when it
  evaluates to `deny`/`no-match` — `WORKSPACE_DEFAULT` and `BUILTIN_DEFAULT`
  never get a chance. The implicit-deny fall-through at `:571-584`
  (`reasonCode: 'BUCKET_POLICY_DENIED'`) is only reachable when
  `orderedPolicies` is empty.
- **G16** (`storage-access-policy.mjs:553-569`) — no test asserts the loop
  iterates beyond the first non-null source.

## What Changes

- Rewrite the loop so a non-`allow` decision from a higher-priority source does
  not short-circuit lower-priority sources; only an explicit `allow` (or an
  admin-bypass) wins. `deny` decisions are stored and surfaced only after every
  source has been evaluated and none returned `allow`.
- Preserve the `SUPERADMIN_OVERRIDE` behaviour — superadmin still wins
  immediately.
- Add coverage for the workspace-default-grants-when-bucket-policy-silent path
  that B1 currently masks.

## Capabilities

### Modified Capabilities

- `data-services`: requirement on storage access-policy evaluation so workspace
  and builtin defaults remain reachable when a bucket policy is configured.

## Impact

- **Affected code**: `services/adapters/src/storage-access-policy.mjs`
  (loop body at `:553-569`, fall-through at `:571-584`),
  `tests/adapters/storage-access-policy.test.mjs`.
- **Migration required**: none — pure compiler change.
- **Breaking changes**: tenants whose bucket policies silently relied on
  bucket-policy-deny to mask a workspace-default-allow will observe the
  workspace default taking effect. This is the intended access-policy contract
  every BaaS in the space publishes.
- **Out of scope**: condition-language expansion (only `object_key_prefix` is
  supported, covered by `harden-g1-credential-redaction-and-providers`'s sibling
  proposals), policy document size limits (already enforced at `:248`).
