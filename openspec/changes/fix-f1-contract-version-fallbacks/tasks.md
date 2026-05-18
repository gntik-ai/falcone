## 1. Failing tests proving the bug

- [ ] 1.1 [test] Add a case to `tests/unit/event-gateway-runtime.test.mjs`
      that boots the gateway with the event-gateway contract export stubbed
      to `undefined` and asserts initialisation throws a typed
      `EventGatewayContractVersionMissingError` rather than returning a
      runtime that uses `'2026-03-24'`.
- [ ] 1.2 [test] Add a case to
      `tests/unit/events-admin.test.mjs` that asserts
      `getKafkaCompatibilitySummary(context).contractVersion` equals the
      runtime's `EVENT_GATEWAY_CONTRACT_VERSION`; the two MUST NOT diverge
      under any branch.

## 2. Implementation

- [ ] 2.1 [fix] Replace the inline fallback at
      `services/event-gateway/src/runtime.mjs:564` and `:873` with a
      reference to the single `EVENT_GATEWAY_CONTRACT_VERSION` constant.
- [ ] 2.2 [fix] Replace the inline fallback at
      `apps/control-plane/src/events-admin.mjs:181` with the same
      constant; remove the `?? '2026-03-25'` literal.
- [ ] 2.3 [impl] Add `EVENT_GATEWAY_CONTRACT_VERSION` to
      `services/event-gateway/src/contract-boundary.mjs`; load it from
      `services/internal-contracts/src/index.mjs` at module top-level and
      throw `EventGatewayContractVersionMissingError` if it is absent or
      empty.
- [ ] 2.4 [docs] Note the boot-time assertion in
      `services/event-gateway/src/README.md` so operators know why a stale
      contract export crashes the service.

## 3. Validation

- [ ] 3.1 [test] Run `corepack pnpm test:unit -- event-gateway-runtime
      events-admin` and `openspec validate
      fix-f1-contract-version-fallbacks --strict`; both green before merge.
