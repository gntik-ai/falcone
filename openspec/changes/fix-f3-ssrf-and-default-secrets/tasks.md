## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add a case to
      `tests/unit/webhook-subscription.test.mjs` that stubs DNS
      resolution of `internal.example.com` to `192.168.1.1` and asserts
      `validateSubscriptionInput({targetUrl: 'https://internal.example.com/hook'})`
      throws `INVALID_URL` with a `private_address` reason.
- [ ] 1.2 [test] Add a case to
      `tests/integration/webhook-management.test.mjs` that boots the
      action with `WEBHOOK_SIGNING_KEY` unset and asserts module load
      throws `WebhookSigningKeyMissingError`; today the code silently
      falls back to `'development-signing-key'`.
- [ ] 1.3 [test] Add a case to
      `tests/integration/webhook-delivery-worker.test.mjs` that sets
      `HTTPS_PROXY=http://attacker.example:8080` and asserts the
      worker's outbound POST ignores the proxy env.

## 2. Implementation

- [ ] 2.1 [fix] Extend
      `services/webhook-engine/src/webhook-subscription.mjs:9-17` to
      DNS-resolve the hostname (A and AAAA), check every resolved
      address against the private/reserved set, reject on any match.
      Return the resolved IPs so the worker can pin them.
- [ ] 2.2 [fix] Remove the `'development-signing-key'` fallback at
      `services/webhook-engine/actions/webhook-management.mjs:43, :141`;
      add a module-top-level assertion that throws
      `WebhookSigningKeyMissingError` if `WEBHOOK_SIGNING_KEY` is
      missing, empty, or equal to the legacy literal.
- [ ] 2.3 [fix] Replace the bare `fetch` default at
      `services/webhook-engine/actions/webhook-delivery-worker.mjs:7`
      with an `undici` Agent constructed with explicit `connect: {
      lookup: pinnedLookup }` and `proxy: undefined`; agent MUST
      ignore `HTTP_PROXY`/`HTTPS_PROXY` env.
- [ ] 2.4 [fix] At delivery time, re-resolve the hostname; if the
      resolved IPs differ from the validation-time set or include a
      private address, fail the delivery as `permanently_failed` with
      `error_detail: 'private_address_resolved'`.
- [ ] 2.5 [migration] Add a one-shot rekey script behind
      `WEBHOOK_REKEY_FROM_DEVELOPMENT_KEY=true` that decrypts every
      `webhook_signing_secrets` row with the legacy literal and
      re-encrypts with the operator-supplied `WEBHOOK_SIGNING_KEY`.

## 3. Validation

- [ ] 3.1 [docs] Document the SSRF guards, the boot-time signing-key
      requirement, and the rekey procedure in
      `services/webhook-engine/README.md`.
- [ ] 3.2 [test] Run `corepack pnpm test:unit -- webhook-subscription`,
      `pnpm test:integration -- webhook-management
      webhook-delivery-worker`, and
      `openspec validate fix-f3-ssrf-and-default-secrets --strict`; all
      green before merge.
