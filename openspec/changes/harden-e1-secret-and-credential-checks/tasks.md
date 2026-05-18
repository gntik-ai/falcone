## 1. Failing tests proving the gaps

- [ ] 1.1 [test] Add `tests/adapters/mongodb-admin.secret-binding.test.mjs`
      calling `buildAdminCredentialBinding({serviceAccountRef: 'not-a-secret'})`;
      assert `MONGO_SECRET_REF_INVALID` is raised — fails today (any string
      accepted).
- [ ] 1.2 [test] Add a test asserting the adapter-call envelope carries
      `quotaDecisionId` and `preExecutionWarnings` includes
      `'quota_race_possible'` whenever a per-create validator computed a
      `quotaDecision`.
- [ ] 1.3 [test] Add a test calling `normalizeName('Bad Name!')` directly
      and asserting `MONGO_NAME_INVALID` is thrown rather than the string
      being returned trimmed.

## 2. Implementation

- [ ] 2.1 [fix] Replace the literal-string construction at
      `services/adapters/src/mongodb-admin.mjs:342` with a call to
      `buildSecretRef(serviceAccountRef)` that (a) validates the ref against
      the configured allowed-scheme set `{secret://, vault://, kms://}` and
      (b) rejects empty or whitespace-only references with
      `MONGO_SECRET_REF_INVALID`.
- [ ] 2.2 [fix] In `buildMongoAdminAdapterCall`, generate
      `quotaDecisionId = uuidv4()` whenever `quotaDecision` is non-null; add
      it to the envelope and push `'quota_race_possible'` into
      `preExecutionWarnings`.
- [ ] 2.3 [fix] Update `mongoAdminRequestContract` /
      `mongoAdminResultContract` in
      `apps/control-plane/openapi/families/mongo.openapi.json` to advertise
      `quotaDecisionId` and the warning enum extension.
- [ ] 2.4 [fix] Tighten `normalizeName` at `mongodb-admin.mjs:256-258` to
      invoke `assertNameValid(name, kind)` (the same regex helper used by
      the per-resource validators) and throw `MONGO_NAME_INVALID` on
      mismatch.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the quota-race contract and the supported
      `secretRef` schemes in `apps/control-plane/src/mongo-admin.mjs` JSDoc.
- [ ] 3.2 [test] Re-run `corepack pnpm test:unit` and `openspec validate
      harden-e1-secret-and-credential-checks --strict`; both green before
      merge.
