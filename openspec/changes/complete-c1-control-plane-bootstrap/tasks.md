## 1. Failing tests

- [ ] 1.1 [test] Add `services/provisioning-orchestrator/src/tests/bootstrap.test.mjs` that boots the service in-process and asserts (a) `/healthz` returns 200, (b) at least one registered action route responds to a well-formed request, and (c) the registered Kafka consumer group includes the three event-recorder topics. Initially the file fails to load because `bootstrap.mjs` does not exist.

## 2. Implementation

- [ ] 2.1 [impl] Add `services/provisioning-orchestrator/src/action-registry.mjs` enumerating all 74 actions with `{name, handlerModule, method, path, scopes}` entries; export a `registerAll(server)` helper.
- [ ] 2.2 [impl] Add `services/provisioning-orchestrator/src/bootstrap.mjs` that creates a Fastify server, calls `action-registry.registerAll`, registers `/healthz` and `/readyz`, starts the Kafka consumer group for the three event recorders, and handles SIGTERM/SIGINT graceful shutdown.
- [ ] 2.3 [impl] Replace `services/provisioning-orchestrator/package.json:7-9` placeholder scripts with real `lint` (eslint), `test` (vitest pointing at `src/tests/**/*.test.mjs` and `tests/**/*.test.mjs`), and `typecheck` (`tsc --noEmit`).
- [ ] 2.4 [docs] Document the bootstrap, action-registry shape, and gateway integration contract in `services/provisioning-orchestrator/README.md`.

## 3. Validation

- [ ] 3.1 [test] Run `pnpm --filter @falcone/provisioning-orchestrator test`, `pnpm --filter @falcone/provisioning-orchestrator lint`, `pnpm --filter @falcone/provisioning-orchestrator typecheck`, and `openspec validate complete-c1-control-plane-bootstrap --strict`; all green before merge.
