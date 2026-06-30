# Tasks: fix-736-async-operations-schema

## 1. Reproduce / encode the bug

- [x] Confirm `POST /v1/async-operation-query` is served by the real
      `async-operation-query.mjs` action in the kind control-plane route map.
- [x] Confirm the list path queries `async_operations`, and logs query
      `async_operation_log_entries` joined to `async_operations`.
- [x] Add a regression test that uses the real boot applier and real migration SQL to
      assert the async-operation tables are created before the action is served.
- [x] Add a regression test that executes the actual async-operation query action list/log
      paths against the boot-created schema and would fail with `42P01` if the tables are
      missing.
- [x] Add a CI-executed `tests/unit` guard for the same acceptance path so PR `quality`
      runs the regression via `pnpm test:unit`.

## 2. Fix

- [x] Add migrations `073`, `074`, `075`, `076`, and `078` to the kind control-plane
      provisioning-orchestrator schema boot set in numeric dependency order.
- [x] Keep the existing governance migrations and order intact after the async-operation
      chain.

## 3. Backend / frontend / wire / docs

- [x] Backend/deploy: apply the async-operation migration chain at control-plane boot
      wherever the route is served.
- [x] Frontend: no code change; the console already calls the route and consumes the same
      `200` response shape.
- [x] Wire/contract: no route, payload, response, status-code, OpenAPI, SDK, generated
      client, or shared-type change.
- [x] Docs: update the kind deployment README and required-migrations note to include the
      async-operation boot migration chain.
- [x] OpenSpec: add the `web-console` capability delta for issue #736.

## 4. Verify

- [x] `node --test tests/blackbox/governance-schema-bootstrap.test.mjs`
- [x] `node --test tests/unit/async-operations-schema-bootstrap.test.mjs`
- [x] `npm run test:unit`
- [x] `npm run lint`
- [x] `npm run lint:md`
- [x] `npm run generate:public-api` (no generated artifact diff)
- [x] `openspec validate fix-736-async-operations-schema --strict`
