## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add a case to
      `tests/unit/webhook-delivery.test.mjs` that calls
      `enforcePayloadSizeLimit` with a payload exceeding `maxBytes`
      and no spillover adapter; assert the function returns
      `{truncated: true, action: 'reject'}` rather than silently
      replacing `payload.data`.
- [ ] 1.2 [test] Add a case to
      `tests/integration/webhook-delivery-worker.test.mjs` that
      records the signed value sent in the
      `x-platform-webhook-signature` header and asserts it equals
      `sha256=HMAC(secret, '${timestamp}.${rawBody}')`, not just
      `HMAC(secret, rawBody)`.
- [ ] 1.3 [test] Add a case asserting the request body's `id` field
      equals `event.eventId` and that the header
      `x-platform-webhook-delivery-id` equals the internal
      `delivery.id`.

## 2. Implementation

- [ ] 2.1 [fix] Replace the silent truncation block at
      `services/webhook-engine/src/webhook-delivery.mjs:58-71` with a
      conditional: if a spillover adapter is wired, write the payload
      via the adapter and return `{payload_ref, payload}` where
      `payload.data = {$ref: payload_ref}`; otherwise return
      `{action: 'reject', reason: 'payload_too_large'}` and let the
      worker mark the delivery `permanently_failed`.
- [ ] 2.2 [fix] Update `services/webhook-engine/src/webhook-signing.mjs`
      so `computeSignature` accepts a `(timestamp, rawBody, secret)`
      triple and signs `${timestamp}.${rawBody}`; keep
      `verifySignature(timestamp, rawBody, secret, header)` symmetric.
- [ ] 2.3 [fix] Update `actions/webhook-delivery-worker.mjs:27` to
      pass the timestamp into `computeSignature`; for one release also
      emit a legacy header `x-platform-webhook-signature-v1` carrying
      the old signature for receiver migration.
- [ ] 2.4 [fix] Update `src/webhook-delivery.mjs:48-56` to set the
      envelope's `id` to `event.eventId`; add header
      `x-platform-webhook-delivery-id` carrying the internal
      `delivery.id` in `actions/webhook-delivery-worker.mjs`.
- [ ] 2.5 [impl] Introduce
      `services/webhook-engine/src/payload-spillover.mjs` as a port
      interface (`writePayload(id, body): Promise<{payload_ref}>`); no
      production adapter is included by this change — the worker
      treats the absence of a wired adapter as
      "reject oversized payloads".

## 3. Validation

- [ ] 3.1 [docs] Document the new signature recipe and the
      `x-platform-webhook-delivery-id` header in
      `services/webhook-engine/README.md`; add a receiver migration
      note for the legacy header sunset.
- [ ] 3.2 [test] Run `corepack pnpm test:unit -- webhook-delivery
      webhook-signing` and `pnpm test:integration --
      webhook-delivery-worker`, then `openspec validate
      fix-f3-signing-and-payload-truncation --strict`; all green
      before merge.
