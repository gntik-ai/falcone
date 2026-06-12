# EPHEMERAL SPIKE — not production code

De-risking spikes for OpenSpec change `add-flows-adr-temporal-spikes` (flows epic #355,
issue #356). Nothing in this directory is imported by `apps/`, `services/`, or `charts/`.
It exists only to convert two architectural assumptions into evidence before the Temporal
adoption ADR (`docs-site/architecture/adrs.md`, ADR-11) is finalized.

- **Spike A** (`spike-a/`): generic YAML DSL interpreter workflow on the Temporal
  TypeScript SDK — proves durable resume after a mid-run worker kill, retry-across-restart,
  replay determinism, and picks an expression engine (CEL vs JSONata).
- **Spike B** (`spike-b/`): namespace-per-tenant vs shared-namespace+search-attributes
  tenancy models, with poller/connection measurements at N = {1, 5, 20} and a
  PostgreSQL SQL-visibility sufficiency proof.

## Temporal dev stack

This spike runs against a local Temporal server backed by **PostgreSQL** for BOTH
persistence and visibility (auto-setup default = SQL visibility on PostgreSQL — Elasticsearch
is explicitly disabled). This is what makes Spike B's visibility query a real
PostgreSQL-SQL-visibility sufficiency proof.

```sh
cd spikes/add-flows-adr-temporal-spikes
docker compose -p flows-spike up -d
# wait until healthy:
docker compose -p flows-spike exec -T temporal \
  temporal operator cluster health --address 127.0.0.1:7233
# ALWAYS tear down (even on failure):
docker compose -p flows-spike down -v
```

Frontend gRPC is published on `127.0.0.1:7233`. Postgres is internal-only (not published).

### Task 1.1 — dev server launch

`temporal server start-dev` (the standalone CLI) is NOT available on the host, and
`@temporalio/testing`'s `TestWorkflowEnvironment.createLocal()` downloads a dev-server
binary at runtime (network-dependent and SQLite-backed — no PostgreSQL visibility). For a
PostgreSQL-backed proof we instead run the official `temporalio/auto-setup:1.25.2` image via
`docker compose` (image pre-pulled). Exact start command: see the block above. This is the
documented, reproducible launch path for both spikes.

### Task 1.2 — Postgres for Temporal SQL visibility

`tests/env` Postgres is NOT reused: the auto-setup image needs the Temporal schema applied to
its own database and the default/visibility schemas seeded, which would pollute the shared
`tests/env` instance. Decision: a **dedicated** `postgres:16-alpine` service inside this
compose file hosts both the Temporal persistence and visibility schemas (auto-setup applies
them on boot). This keeps the spike self-contained and gives a true PostgreSQL visibility
store for Spike B (verdict recorded in `spike-b/measurements.md`).

### Task 1.3 — ephemeral marker

Every file here carries an `EPHEMERAL SPIKE — not production code` header. Both spike
`package.json` files are `"private": true` and named `@spike/...`.

## Custom search attribute (Spike B)

`tenantId` (Keyword) is registered against the spike namespace(s) before tagging workflows:

```sh
docker compose -p flows-spike exec -T temporal \
  temporal operator search-attribute create \
    --namespace default --name tenantId --type Keyword --address 127.0.0.1:7233
```

The Spike B driver does this programmatically per namespace it provisions.
