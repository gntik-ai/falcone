## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add `apps/control-plane/src/saga/saga-state-store.test.mjs` with a
      case that submits the same `idempotencyKey` to two different `workflowId`s
      under one `tenantId` and asserts the second call must not return the first
      workflow's output.
- [ ] 1.2 [test] Add a case that loads `saga-engine.mjs` with `ADAPTER_URL` pointing
      at a non-existent module and asserts `executeSaga` throws rather than
      returning success with empty rows.
- [ ] 1.3 [test] Add a case that constructs a saga with one step in `succeeded`,
      one in `compensation-failed`, and runs `recoverInFlightSagas`; assert the
      filter selects neither.
- [ ] 1.4 [test] Add a case that crashes a saga between `executeSaga` start and
      end, then re-invokes with the same idempotency key; assert the second
      invocation observes the prior `in-progress` record rather than starting fresh.

## 2. Implementation

- [ ] 2.1 [migration] Add migration that extends `saga_instances` and the
      idempotency-record table with `workflow_id` and a `UNIQUE(tenant_id,
      idempotency_key, workflow_id)` constraint; backfill existing rows.
- [ ] 2.2 [fix] Tighten `saga-state-store.mjs:124-127` to include `workflow_id` in
      the WHERE clause and in `saga-engine.mjs:61-64` to assert the row's
      `workflow_id === workflowId` before short-circuiting.
- [ ] 2.3 [fix] Replace the silent `.catch(() => ({}))` import in
      `saga-state-store.mjs:10-15` with a fail-fast loader that throws on missing
      adapter; remove the `{ rows: [] }` fallback so query errors propagate.
- [ ] 2.4 [fix] Rewrite the eligibility filter in `saga-engine.mjs:155` to
      `step => step.status === 'compensating'`; move retry of `compensation-failed`
      into `saga-compensation.mjs` behind backoff state recorded on the step row.
- [ ] 2.5 [fix] Insert the `in-progress` idempotency record at the top of
      `executeSaga` and transition it to terminal states at the existing
      completion site (`saga-engine.mjs:139-141`).

## 3. Docs and validation

- [ ] 3.1 [docs] Document the new idempotency contract (key + tenant + workflow)
      in `apps/control-plane/src/README.md`.
- [ ] 3.2 [test] Re-run `corepack pnpm test:unit` and `openspec validate
      fix-a1-saga-state-store --strict`; both green before merge.
