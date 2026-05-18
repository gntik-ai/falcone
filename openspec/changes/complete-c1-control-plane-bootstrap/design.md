## Context

`services/provisioning-orchestrator/` is the largest service in the platform (312 files; 74 action handlers; 29 migrations) but is shipped as a library of `main`-exporting modules with no runtime entrypoint. The current deployment assumption — implicit in `helm/` and `services/gateway-config/` but not anywhere in this package — is that each action module is wrapped as an OpenWhisk action and exposed via APISIX routes declared elsewhere. This split has three concrete pain points the audit identified:

- The mapping action -> route -> scopes lives nowhere as a single source of truth; gateway-config and the orchestrator can drift.
- Local development requires a full OpenWhisk + APISIX stack to invoke any action; there is no `node bootstrap.mjs` equivalent.
- `package.json:7-9` scripts are placeholders, so the CI pipeline reports clean while the 62 existing test files never run.

This proposal completes the bootstrap so the orchestrator is independently runnable, the action -> route mapping is in-package, and the quality gates run on every PR — without breaking the existing OpenWhisk wrapping (the `main` exports stay).

## Goals / Non-Goals

**Goals**
- A single `node src/bootstrap.mjs` command brings the orchestrator up with all 74 actions exposed over HTTP and the three Kafka consumer groups subscribed.
- One declarative `action-registry.mjs` is the source of truth for `name`, `handlerModule`, `method`, `path`, `scopes`. The APISIX route generator in `services/gateway-config/` consumes this file (out of scope to land in this proposal, tracked separately).
- `pnpm test`, `pnpm lint`, `pnpm typecheck` all do real work.

**Non-Goals**
- Replacing OpenWhisk. The existing `main` exports remain; OpenWhisk wrappers continue to work in production. Bootstrap is a parallel path for local dev, in-cluster non-OW deployments, and integration tests.
- Implementing the APISIX route generation in `services/gateway-config/`. That belongs to its own proposal once `action-registry.mjs` exists.
- Wiring test content gaps — `coverage-c1-orchestrator-tests` handles that.

## Decisions

### Decision: Fastify over Express for the HTTP server

- **What:** Use `fastify` as the HTTP server framework.
- **Why:** Fastify is already used by `services/gateway-config/` and `apps/control-plane/` (per existing dependencies); reusing the dependency reduces lockfile churn and shares the request-context plumbing.
- **Alternatives:** Express (rejected: larger surface area, slower JSON parsing, not already a dependency).

### Decision: Action registry as a flat array exported from `action-registry.mjs`

- **What:** A single file exports `[{name, handlerModule: () => import('./actions/...'), method, path, scopes}, …]`. Bootstrap iterates and calls `server.route(...)` for each entry. The same array is exported for consumption by `services/gateway-config/`.
- **Why:** A flat array is the smallest possible single-source-of-truth shape; tooling can lint it; tests can assert per-action that the file exists.
- **Alternatives:** Decorator/annotation-based registration on each action module (rejected: requires a transpile step and TS reflection); per-action route file (rejected: 74 files of boilerplate, no one place to read the contract).

### Decision: Kafka consumer group is started inside bootstrap, not as a separate process

- **What:** `bootstrap.mjs` initialises one Kafka client (`kafkajs`) and three consumer groups (privilege-domain, function-privilege, scope-enforcement). All run in the same Node process.
- **Why:** The three recorders are low-throughput; running them in a sidecar would double the deployment surface for marginal isolation benefit. If a single recorder needs scaling it can be hoisted to a sidecar later via the action-registry shape.
- **Alternatives:** One process per consumer (rejected: deployment cost); coupling to OpenWhisk triggers (rejected: keeps the bootstrap purely Node-native).

### Decision: `/healthz` is liveness-only; `/readyz` checks Postgres and Kafka

- **What:** `/healthz` returns 200 if the process is up. `/readyz` returns 200 only after Postgres `SELECT 1` and Kafka admin `listGroups` both succeed within 1s.
- **Why:** Kubernetes standard separation: liveness should not flap on transient backend issues; readiness gates traffic.
- **Alternatives:** Combined endpoint (rejected: causes pod restarts on transient outages).

### Decision: `package.json` test runner is vitest, not node-tap or mocha

- **What:** `vitest` matches the project conventions (already used by `apps/control-plane/` and the new add-* services); test files are `**/*.test.mjs`.
- **Why:** Consistent test runner across the repo; vitest's globbing handles the `src/tests/` + `tests/` split without config gymnastics.
- **Alternatives:** node-tap (rejected: dependency not present), mocha (rejected: deprecated direction in this repo).

## Risks / Trade-offs

- **OpenWhisk and Fastify both running in production.** If production keeps OpenWhisk wrappers, the bootstrap path runs only in dev/integration. Documentation must be clear about which path is which; otherwise an action may be exercised in dev that is never reachable in prod.
- **Three consumer groups in one process.** A panic in any recorder takes all three down. Acceptable for low-throughput audit; revisit if QPS grows.
- **Test runner change may surface latent failures.** Activating the 62 test files will likely reveal failures (the whole point). `coverage-c1-orchestrator-tests` is the explicit follow-up to triage those.

## Migration Plan

1. Land this proposal: add `bootstrap.mjs`, `action-registry.mjs`, working scripts.
2. Run `pnpm test` in CI as a non-blocking check for one week; triage failures into `coverage-c1-orchestrator-tests`.
3. Flip CI to blocking; gateway-config gains a generator consuming `action-registry.mjs` (separate proposal).
4. Deprecate the implicit OpenWhisk action-name conventions in favour of `action-registry.mjs` (separate proposal).

## Open Questions

- Should the action-registry carry `idempotencyScope` (none/tenant/workspace) alongside `scopes`? Defer to a follow-up once a second consumer (the SDK builder) needs that signal.
- Should `/readyz` also probe Vault? The orchestrator's secret-rotation paths depend on it; argued both ways. Defer; current design keeps `/readyz` to "this pod can serve traffic" rather than "the whole platform is up".
