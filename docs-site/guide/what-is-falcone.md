# What is In Falcone?

::: danger Not production-ready
In Falcone is in early, active development — APIs, schemas and behavior may change without
notice, there are no stability/security/support guarantees, and it has not had a security audit.
Use it for evaluation and development only, never for production workloads or sensitive data. See
the [Roadmap](/guide/roadmap).
:::

**In Falcone** (codename *Falcone*) is a **multi-tenant Backend-as-a-Service (BaaS)**. It gives application teams the building blocks they would otherwise assemble by hand — databases, object storage, an event bus, serverless functions, authentication and realtime subscriptions — behind a **single API gateway**, with **tenant isolation enforced at every layer**.

A single platform instance hosts many **tenants**. Each tenant owns one or more **workspaces** (the unit a project's data lives in), and every read and write is scoped to the calling tenant. The cardinal rule of the platform is that **no tenant can ever observe or mutate another tenant's data** — this is enforced in the database (PostgreSQL Row-Level Security), in the data adapters (injected tenant predicates), and in the realtime pipeline (tenant-scoped change matching).

## What you can do with it

| Capability | What it gives you | Backed by |
| --- | --- | --- |
| **Relational data API** | REST CRUD + query + DDL over SQL tables, with keyset pagination and filtering | PostgreSQL |
| **Document data API** | REST CRUD + query over collections, with cursor pagination | FerretDB + DocumentDB (MongoDB-wire-compatible) |
| **Object storage** | S3-compatible buckets and objects | SeaweedFS |
| **Events** | Publish/subscribe to a tenant-scoped event stream | Kafka / Redpanda |
| **Serverless functions** | Deploy and invoke per-tenant functions | Knative runtime |
| **Realtime** | Subscribe to live data changes over Server-Sent Events | Postgres logical replication (document store) + Postgres trigger CDC |
| **Identity & access** | Users, roles, service accounts, JWTs and API keys per tenant | Keycloak (OIDC) |
| **Tenant administration** | Provision tenants/workspaces, members, plans, quotas | Control plane |
| **Observability & quotas** | Per-tenant usage, metrics, audit and hard limits | Prometheus + control plane |

These map to the platform's public HTTP surface, split into two privilege domains:

- **`structural_admin`** — tenant/workspace lifecycle, schemas, functions deployment, API keys, service configuration and quotas.
- **`data_access`** — the day-to-day data plane: documents, queries, objects, function invocation, analytics, event publish/subscribe.

See the [API Reference](/api/control-plane) for the full route catalog.

## Built for AI: a BaAIS

In Falcone starts from the same foundation as any backend platform — multi-tenant data, auth,
storage, events and functions behind one API — and points it at how software is increasingly
built and operated: **by, and for, AI agents.**

We call this category a **BaAIS** — a *Backend-as-an-AI-Service*, a play on "BaaS" for an
AI-native world. (The expansion is deliberately loose; what matters is the direction, not the
acronym.) Concretely, it means a tenant's backend is designed to be **natively consumable by
agents**, not only by application code:

- **MCP server hosting** *(Preview)* — expose a tenant's backend (data, storage, functions) as a
  [Model Context Protocol](https://modelcontextprotocol.io) server, so any MCP-capable agent can
  discover and call it under that tenant's own isolation, auth and quotas. The management API is
  served live under `/v1/mcp`; Instant MCP and the official server work end-to-end. See the
  [MCP guide](/guide/mcp).
- **Agentic workflows** *(Preview)* — the Temporal-based [Flows](/guide/flows) engine runs durable,
  multi-step workflows with a first-party activity catalog whose credentials are tenant-scoped —
  the reliable substrate an agent needs to act across services.

Everything an agent touches stays inside the same tenant-isolation contract as the rest of the
platform: scoped by tenant and workspace, gated by plan capabilities, and audited. See the
[Roadmap](/guide/roadmap) for what's in flight.

## A guided tour of a real deployment

The following screenshots are taken from a live cluster running the full stack (gateway, control plane, executor, console, Keycloak, PostgreSQL, FerretDB + DocumentDB, Kafka, SeaweedFS).

### Sign in

The console authenticates against Keycloak (OIDC). Operators and developers land on the platform with a tenant context.

![Console login](/screens/01-login.png)

![After login](/screens/02-after-login.png)

### Tenants & workspace context

Tenants are the top-level isolation boundary. Selecting a tenant sets the **context** that scopes everything you do next.

![Tenants list](/screens/03-tenants.png)

![Active context](/screens/04-context.png)

### Identity, members & service accounts

Each tenant manages its own users, roles and machine identities. Service accounts mint credentials used by applications and CI.

![IAM](/screens/07-iam.png)

![Members](/screens/08-members.png)

![Service accounts](/screens/14-service-accounts.png)

![Service-account credential](/screens/15-sa-credential.png)

### Databases — PostgreSQL & the FerretDB document store

The console exposes both data engines. You can browse schemas and tables in PostgreSQL and collections/documents in the FerretDB-backed document store (MongoDB-wire-compatible, over DocumentDB) — all scoped to the active tenant.

![Database home](/screens/05-database.png)

![PostgreSQL databases](/screens/20-postgres.png)

![PostgreSQL table browser](/screens/21-postgres-table.png)

![Document databases (FerretDB-backed)](/screens/18-mongo.png)

![Document explorer (FerretDB-backed)](/screens/19-mongo-documents.png)

### Object storage

S3-compatible buckets and objects, per tenant.

![Storage buckets](/screens/16-storage.png)

![Storage objects](/screens/17-storage-objects.png)

### Events

A tenant-scoped event bus with topics.

![Kafka topics](/screens/22-kafka.png)

![Kafka topic detail](/screens/23-kafka-topic.png)

### Serverless functions

Deploy functions and invoke them from the console.

![Functions](/screens/26-functions.png)

![Function invocation](/screens/27-functions-invoke.png)

### Plans, quotas & observability

Plans define entitlements; quotas enforce per-tenant limits; observability surfaces usage and operations.

![Plans](/screens/10-plans.png)

![Plan detail](/screens/11-plan-detail.png)

![Quotas](/screens/12-quotas.png)

![Observability](/screens/13-observability.png)

![Operations](/screens/24-operations.png)

![Operation detail](/screens/25-operation-detail.png)

## How it fits together (in one paragraph)

A request enters through the **APISIX gateway**, which classifies it by credential (an `apikey` header for anon/service keys, or a Bearer JWT) and routes it to the right backend. Structural-admin calls reach the **control plane**; data-plane calls reach the **executor**, which runs adapter-built query plans against the real **PostgreSQL** / **FerretDB + DocumentDB** / **Kafka** / **SeaweedFS** backends. The executor resolves identity (API key is authoritative, then verified JWT, then gateway-injected headers) and **stamps and filters by the tenant** on every operation. Realtime rides the same identity model over SSE. The whole thing is packaged as one **umbrella Helm chart** you can target at Kubernetes, OpenShift or an air-gapped registry.

Continue to the [Architecture overview](/architecture/overview) for the detailed design, or jump to the [Quickstart](/guide/quickstart) to build a TODO app.
