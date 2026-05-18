## Why

`services/provisioning-orchestrator/` exposes 74 action handlers and is the entry point for plans, quotas, async operations, tenant config, secrets, privilege, and scope governance — but the package ships no HTTP server, no Kafka consumer bootstrap, and no scheduler binding. From `openspec/audit/cap-c1-plan-tenant-provisioning.md`:

- **G1** — "No HTTP/RPC bootstrap in this service. The action functions are exported as `main` factories; the runtime that calls them lives outside this package. `src/http/` contains a single file: `safe-url.mjs`. The mapping action -> OpenWhisk action name -> gateway route is not in this package." The platform documentation describes OpenWhisk via APISIX as the runtime, but the binding is implicit.
- **G2** — "`package.json:7-9` runs `node -e \"console.log('… placeholder')\"` for lint/test/typecheck. No quality gate runs in CI for the orchestrator." Combined with G16 (62 test files not wired to `pnpm test`) the build pipeline reports clean on a service with zero binding.

This proposal completes the bootstrap so the orchestrator is independently runnable and verifiable, the action -> route mapping is declared in this package, and the placeholder scripts in `package.json` are replaced with real lint/test/typecheck gates. The design is non-trivial — see `design.md` for the runtime architecture decision.

## What Changes

- Add a `bootstrap.mjs` entrypoint that registers all 74 action handlers behind a Fastify HTTP server, exposes `/healthz` and `/readyz`, and starts the Kafka consumer group for the three event recorders (privilege-domain, function-privilege, scope-enforcement).
- Add a per-action `action-registry.mjs` that maps action name -> handler module -> HTTP route shape (method, path, scopes) so the gateway-config layer can generate APISIX routes from a single source of truth.
- Replace placeholder scripts in `package.json:7-9` with `lint` (eslint), `test` (vitest, picking up `src/tests/**/*.test.mjs` and `tests/**/*.test.mjs`), and `typecheck` (`tsc --noEmit` over the `.d.ts` shipped with the package).
- Wire the test target so the 62 existing tests are invoked (also satisfies `coverage-c1-orchestrator-tests`'s G16 partially — that proposal still covers the test-content gaps).
- Document the bootstrap in `services/provisioning-orchestrator/README.md`.

## Capabilities

### Modified Capabilities

- `tenant-lifecycle`: introduces the orchestrator's HTTP/Kafka bootstrap, the action-registry single source of truth, and a working quality-gate pipeline.

## Impact

- Affected code: new `services/provisioning-orchestrator/src/bootstrap.mjs`, new `services/provisioning-orchestrator/src/action-registry.mjs`, edits to `services/provisioning-orchestrator/package.json`, edits to `services/provisioning-orchestrator/README.md`.
- Migrations: no schema migration.
- Breaking changes: callers that currently rely on the implicit OpenWhisk wrapping outside this package must continue to work; the new bootstrap is additive (the action factories still export `main`).
- Out of scope: gateway-config / APISIX route generation (lives in `services/gateway-config/`); test-content backfill (covered by `coverage-c1-orchestrator-tests`).
