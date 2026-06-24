# Contributing

In Falcone is developed test-first against **real backends**, with spec-driven changes. This page summarizes the workflow encoded in the repository tooling.

## Local development

Bring up the real backends with docker-compose and run the suites against them:

```bash
cd tests/env && docker compose up -d      # Postgres, FerretDB + DocumentDB, Keycloak, Redpanda, SeaweedFS, OpenBao, APISIX
```

See [Installation → Docker Compose](/guide/installation#docker-compose-local).

## Test suites

| Command | What it runs |
| --- | --- |
| `npm run test:unit` | Unit tests |
| `npm run test:adapters` | Adapter (plan-builder) tests |
| `npm run test:contracts` | API/OpenAPI contract tests |
| `npm run test:e2e:console` / `:deployment` / `:observability` / `:workflows` | E2E families |
| `npm run test:e2e:realtime` | Realtime (needs the FerretDB + DocumentDB document store with `wal_level=logical` for the logical-replication slot) |
| `npm run test:e2e:restore` | Tenant backup/restore workflows |
| `npm run test:resilience` | Resilience tests |

The black-box contract suite is the gate before declaring work done; realtime and RLS behaviours are only meaningfully testable against the **real** compose stack (RLS does not apply to superusers, so it can't be exercised in-memory).

## Linting & validation

```bash
npm run lint        # validate:repo + lint:md + validate:openapi
```

`validate:repo` runs a battery of structural/contract validators (domain model, public API, gateway policy, deployment chart/topology, authorization model, and the `observability-*` schema checks). CI runs `lint` plus the unit/adapter/contract suites in its `quality` job.

## Spec-driven changes (OpenSpec)

Every bug fix or feature is an OpenSpec **change**, following `propose → apply → verify → archive`:

```bash
openspec list                 # see active changes
openspec show <change-id>
openspec validate <change-id> --strict
```

Changes are scaffolded and worked through with the native OpenSpec tooling rather than hand-written. Work test-first: a failing black-box test reproduces a bug (or covers a scenario) before the fix; never edit tests just to make them pass.

> [!TIP]
> Generated change proposals can drift from the code — verify route paths against `public-route-catalog.json` and event-schema reuse before implementing a backlog change.

## Conventions

- Repo-facing artifacts (specs, issues, tests, comments) are in **English**.
- Tenant isolation is the cardinal concern: every data path must be tenant-scoped, and tenancy-sensitive changes should include cross-tenant probes.
- Keep CI green; don't expose secrets (even provider-shaped fixtures get push-rejected).

## Documentation

This site is a VitePress project under `docs-site/`. Preview locally:

```bash
cd docs-site
pnpm install
pnpm dev          # local preview
pnpm build        # production build (what CI publishes)
```

It is published to GitHub Pages by `.github/workflows/deploy-docs.yml` on every push to `main` that touches `docs-site/`.
