## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add `tests/adapters/mongodb-admin.audit-rejection.test.mjs`
      calling `buildMongoAdminAdapterCall` with a `create_user` request whose
      `payload.password = 'plaintext-secret'`; assert the returned envelope
      carries `{ok: false, rejectedEvent: {outcome: 'rejected', …}}` and the
      audit event's payload field for `password` is the redacted sentinel —
      fails today (no rejection event emitted).
- [ ] 1.2 [test] Add a case calling the same with a missing role binding;
      assert the rejection event carries the violation array and a
      sanitized payload (no secret fields present).
- [ ] 1.3 [test] Add a case asserting `mongo.admin.<resourceKind>.accepted`
      is emitted on success (regression coverage that this change doesn't
      break the happy path).

## 2. Implementation

- [ ] 2.1 [fix] Add a `redactSecretsAtBoundary(payload)` helper at the top of
      `services/adapters/src/mongodb-admin.mjs` that walks the payload and
      replaces `password`, `passwordBinding.value`, and any field whose
      JSONPath matches a configured deny-list with `{__redacted: true,
      fieldPath}`. Call it as the very first line of
      `buildMongoAdminAdapterCall` before `validateMongoAdminRequest`.
- [ ] 2.2 [fix] Extract `adminEvent` construction at `mongodb-admin.mjs:1726-1741`
      into `buildAdminEvent({resourceKind, outcome, payload, violations?})`;
      call with `outcome: 'accepted'` on success and `outcome: 'rejected'`
      with the violations array on failure.
- [ ] 2.3 [fix] Update `buildMongoAdminAdapterCall`'s early-return branch at
      `:1682-1689` to include `rejectedEvent: buildAdminEvent({resourceKind,
      outcome: 'rejected', payload: redactedPayload, violations})` in the
      returned object.
- [ ] 2.4 [fix] Update `apps/control-plane/openapi/families/mongo.openapi.json`
      so `mongoAdminEventContract` advertises `outcome ∈ {accepted,
      rejected}`.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the rejection-event shape and the redaction
      sentinel in `apps/control-plane/src/mongo-admin.mjs` JSDoc.
- [ ] 3.2 [test] Re-run `corepack pnpm test:unit` and `openspec validate
      fix-e1-password-and-audit-leak --strict`; both green before merge.
