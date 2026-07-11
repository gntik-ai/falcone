# Roadmap

::: warning Pre-1.0 — direction, not a commitment
In Falcone is in early, active development. This page describes near-term direction; scope, order
and timing can change. See [Project status](#project-status) below.
:::

## Shipped (Preview)

These have landed and are documented; they remain **Preview** under the not-production-ready posture.

- **[Flows](/guide/flows) — durable workflow engine (Temporal).** A JSON-Schema / YAML
  [DSL](/architecture/workflow-dsl-reference) and interpreter worker, a first-party activity
  catalog with tenant-scoped credentials, triggers (schedules, webhooks, platform events) and a
  visual designer in the web console ([epic #355](https://github.com/gntik-ai/falcone/issues/355)).
- **[MCP server hosting](/guide/mcp).** In Falcone is becoming a **BaAIS** — a backend consumed by
  AI agents (see [Built for AI](/guide/what-is-falcone#built-for-ai-a-baais)). The management API is
  served live under `/v1/mcp`; **Instant MCP** and the **official server** work end-to-end (create →
  curate → publish → call → observe), with per-tenant isolation, OAuth, quotas, registry/versioning
  and audit ([epic #386](https://github.com/gntik-ai/falcone/issues/386)).

## MCP — next increments — *in progress / planned*

- **PostgreSQL store hardening** — add operator dashboards, retention controls, and migration
  runbooks around the shipped durable MCP registry/version/audit/rate-limit store.
- **Custom (BYO-image) hosting on the live path** — the deploy-spec builder + supply-chain checks
  exist; wire a per-server Knative ksvc into the create path.
- **Workflows-as-MCP-tools** — wire the (built, tested) flow→Task mapping into the live management
  API.
- **Direct MCP-protocol connection** — connect to a per-server ksvc instead of mediating tool calls
  through the control-plane.

## Infrastructure migrations — *complete*

- **Object storage — MinIO → SeaweedFS.** **SeaweedFS** (Apache-2.0) is the object store
  ([ADR-13](/architecture/adrs#adr-13-migrate-object-store-from-minio-to-seaweedfs)), deployed by
  the umbrella chart and enabled by default. The former MinIO `storage` component has been removed
  and the cutover window is closed. See the [SeaweedFS Storage Runbook](/architecture/seaweedfs).
- **Document store — MongoDB → FerretDB + DocumentDB.** **FerretDB v2** (Apache-2.0,
  MongoDB-wire-compatible) over a **DocumentDB / PostgreSQL** engine (MIT) is the document store
  ([ADR-14](/architecture/adrs#adr-14-migrate-document-store-from-mongodb-to-ferretdb-v2-documentdb)),
  deployed by the umbrella chart. The former MongoDB server component has been removed and the
  cutover/rollback window is closed. The MongoDB driver, wire protocol and Mongo-style data API are
  unchanged. See the [FerretDB Document-Store Runbook](/architecture/ferretdb).
- **Functions — OpenWhisk → Knative.** Functions run on a Knative-based runtime provisioned by the
  control-plane executor; the bundled OpenWhisk engine has been removed. The public functions API
  keeps the OpenWhisk-compatible action/package/trigger/rule model.

## Toward a first stable release — *planned*

A security review, API/schema stability guarantees, and migration tooling — the work that has to
land before In Falcone is safe for production.

## Project status

In Falcone is **not production-ready**. Public APIs, data schemas and runtime behavior may change
without notice; there are no stability, security or support guarantees; and the project has not
undergone a security audit. Use it for evaluation, experimentation and development only.
