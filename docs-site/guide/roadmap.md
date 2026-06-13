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

- **Durable, multi-replica server registry** — replace the current in-memory store with a
  Postgres-backed registry on the metadata pool.
- **Custom (BYO-image) hosting on the live path** — the deploy-spec builder + supply-chain checks
  exist; wire a per-server Knative ksvc into the create path.
- **Workflows-as-MCP-tools** — wire the (built, tested) flow→Task mapping into the live management
  API.
- **Direct MCP-protocol connection** — connect to a per-server ksvc instead of mediating tool calls
  through the control-plane.

## Infrastructure — under evaluation — *planned*

- **Object storage / document DB alternatives.** The platform ships **MinIO** (object storage) and
  **MongoDB** (document API) today. Evaluating source-available / lighter alternatives (e.g.
  SeaweedFS for object storage; FerretDB over a DocumentDB-compatible backend) is **planned** — no
  implementation exists in the repo yet, and the backends are swappable at the deployment layer.

## Toward a first stable release — *planned*

A security review, API/schema stability guarantees, and migration tooling — the work that has to
land before In Falcone is safe for production.

## Project status

In Falcone is **not production-ready**. Public APIs, data schemas and runtime behavior may change
without notice; there are no stability, security or support guarantees; and the project has not
undergone a security audit. Use it for evaluation, experimentation and development only.
