# Roadmap

::: warning Pre-1.0 — direction, not a commitment
In Falcone is in early, active development. This page describes near-term direction; scope, order
and timing can change. See [Project status](#project-status) below.
:::

## MCP server hosting — *in active development*

In Falcone is becoming a **BaAIS** — a backend built to be consumed by AI agents (see
[Built for AI](/guide/what-is-falcone#built-for-ai-a-baais)). The headline effort is **hosting
[Model Context Protocol](https://modelcontextprotocol.io) servers**: a tenant will be able to
expose its backend — data, storage, functions — as an MCP server, so any MCP-capable agent can
discover and call it under that tenant's own isolation, authentication and quotas.

## Flows — durable workflow engine (Temporal) — *in progress*

The Temporal-based [Flows](/guide/flows) capability is landing now: a JSON-Schema / YAML DSL and
an interpreter worker, a first-party activity catalog with tenant-scoped credentials, triggers
(schedules, webhooks and platform events) and a visual designer in the web console. Tracked under
[epic #355](https://github.com/gntik-ai/falcone/issues/355).

## Toward a first stable release — *planned*

A security review, API/schema stability guarantees, and migration tooling — the work that has to
land before In Falcone is safe for production.

## Project status

In Falcone is **not production-ready**. Public APIs, data schemas and runtime behavior may change
without notice; there are no stability, security or support guarantees; and the project has not
undergone a security audit. Use it for evaluation, experimentation and development only.
