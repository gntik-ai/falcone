## 1. Failing tests

- [ ] 1.1 [test] Add a case in `tests/adapters/storage-access-policy.test.mjs`
      that constructs a `BUCKET_POLICY` returning `no-match` for the requested
      action and a `WORKSPACE_DEFAULT` that explicitly allows it; assert the
      final decision is `allow` (proves B1 at
      `services/adapters/src/storage-access-policy.mjs:553-569`).
- [ ] 1.2 [test] Add a case with `BUCKET_POLICY` returning `deny` and
      `BUILTIN_DEFAULT` returning `allow`; assert the final decision is `deny`
      (deny is sticky — bucket-policy explicit denies still take precedence).
- [ ] 1.3 [test] Add a case with no policies and assert the implicit-deny
      fall-through at `:571-584` still fires with `reasonCode: 'NO_POLICY_BOUND'`.

## 2. Implementation

- [ ] 2.1 [fix] Rewrite the loop at `storage-access-policy.mjs:553-569` to
      collect every source's decision, returning early only on
      `SUPERADMIN_OVERRIDE` allow or the first non-bucket `allow`; otherwise
      iterate through `WORKSPACE_DEFAULT` and `BUILTIN_DEFAULT` before
      finalising.
- [ ] 2.2 [fix] Preserve explicit `deny` precedence: if any evaluated source
      returns `deny`, the final decision MUST be `deny` even if a later source
      would have allowed; document the precedence in the source comment.
- [ ] 2.3 [fix] Adjust the fall-through block at `:571-584` so its `reasonCode`
      reflects whether the deny came from a bucket policy, a workspace default,
      or absence of any source.

## 3. Validation

- [ ] 3.1 [spec] Land the spec delta under `specs/data-services/spec.md`
      describing the multi-source evaluation contract.
- [ ] 3.2 [docs] Update the adapter README to document the new precedence rules
      and the conditions under which workspace defaults take effect.
- [ ] 3.3 [test] Run `corepack pnpm test:unit -- storage-access-policy` and
      `openspec validate fix-g1-access-policy-fallthrough --strict`; both green
      before merge.
