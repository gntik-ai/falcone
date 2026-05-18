## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add a case to `tests/unit/event-gateway-runtime.test.mjs`
      that calls `resolveEventGatewayProfile({planId: 'pln_freebie'}, topic)`
      and asserts the call throws an unknown-plan error rather than returning
      the `'starter'` profile.
- [ ] 1.2 [test] Add a case that supplies `planId: 'pln_my_enterprise_v2'`
      and asserts the call throws (substring match must no longer promote
      arbitrary ids into the `'enterprise'` tier).
- [ ] 1.3 [test] Add a case that supplies a misspelled `'pln_growht'` and
      asserts an audit event `console.event_gateway.plan_resolution_failed`
      is emitted with the offending id.

## 2. Implementation

- [ ] 2.1 [fix] Replace the substring matcher at
      `services/event-gateway/src/runtime.mjs:138-147` with an exact-match
      lookup against a `KNOWN_PLAN_TIERS` table; export the table from
      `services/event-gateway/src/contract-boundary.mjs`.
- [ ] 2.2 [fix] Introduce a typed `EventGatewayUnknownPlanError` thrown by
      `derivePlanTier` and let `resolveEventGatewayProfile` propagate it
      verbatim; remove the implicit `'starter'` fallthrough.
- [ ] 2.3 [impl] Emit
      `console.event_gateway.plan_resolution_failed` audit envelope from
      the throw site with `{planId, tenantId, workspaceId, decision: 'reject'}`.
- [ ] 2.4 [fix] Update `apps/control-plane/src/events-admin.mjs` callers to
      map `EventGatewayUnknownPlanError` to a `403`-equivalent contract
      violation (not a `500`).

## 3. Docs and validation

- [ ] 3.1 [docs] Document the `KNOWN_PLAN_TIERS` table and the
      fail-closed contract in `services/event-gateway/src/README.md`.
- [ ] 3.2 [test] Run `corepack pnpm test:unit -- event-gateway-runtime` and
      `openspec validate fix-f1-plan-tier-resolution --strict`; both green
      before merge.
