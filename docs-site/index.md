---
layout: home

hero:
  name: In Falcone
  text: Multi-tenant Backend-as-a-Service
  tagline: Postgres & MongoDB data APIs, object storage, events, serverless functions and realtime — behind one gateway, isolated per tenant, deployable to Kubernetes, OpenShift or air-gapped clusters.
  image:
    src: /img/logo-wide.png
    alt: In Falcone
  actions:
    - theme: brand
      text: What is In Falcone?
      link: /guide/what-is-falcone
    - theme: alt
      text: Quickstart (TODO app)
      link: /guide/quickstart
    - theme: alt
      text: Architecture
      link: /architecture/overview

features:
  - icon: 🏢
    title: Tenant isolation by construction
    details: Every data path is scoped by tenant. PostgreSQL Row-Level Security + a non-BYPASSRLS application role, MongoDB adapter-injected tenant filters, and per-tenant realtime channels. Cross-tenant access fails closed.
    link: /architecture/security
    linkText: Security model
  - icon: 🗄️
    title: Postgres & MongoDB data APIs
    details: REST data access over both engines with keyset pagination, filtering and DDL. One control plane, two storage shapes.
    link: /api/postgresql
    linkText: Data API
  - icon: 🔑
    title: Anon & service API keys
    details: Supabase-style flc_anon_… and flc_service_… keys routed at the gateway, plus per-tenant JWT issuance. Embed read-only access in a frontend safely.
    link: /api/gateway
    linkText: Gateway & keys
  - icon: ⚡
    title: Realtime subscriptions
    details: Server-Sent Events backed by MongoDB change streams and PostgreSQL trigger-based CDC, tenant-scoped inside the pipeline.
    link: /api/realtime
    linkText: Realtime
  - icon: 📦
    title: Storage, events & functions
    details: S3-compatible object storage (SeaweedFS), an event bus (Kafka/Redpanda) and serverless functions round out the BaaS surface.
    link: /architecture/services
    linkText: Components
  - icon: 🚀
    title: Deploy anywhere
    details: A single umbrella Helm chart with layered values for Kubernetes (Ingress), OpenShift (Routes, restricted-v2) and air-gapped private registries — plus a docker-compose stack for local development.
    link: /guide/installation
    linkText: Installation
  - icon: 🤖
    title: Built for AI — a BaAIS
    details: A backend designed to be natively consumable by AI agents — MCP server hosting (Preview, served live under /v1/mcp) and the Temporal-based Flows workflow engine (Preview) — all under the same per-tenant isolation, auth and quotas.
    link: /guide/mcp
    linkText: MCP &amp; Flows
---

::: danger Not production-ready
**In Falcone is in early, active development.** Public APIs, data schemas and runtime behavior
may change at any time, without notice or a migration path; there are no stability, security or
support guarantees; and the project has not undergone a security audit. **Do not use it for
production workloads or sensitive data** — evaluation, experimentation and development only. See
the [Roadmap](/guide/roadmap).
:::

## A first look

In Falcone ships with a web console for tenant administration and data exploration. The screenshots below are from a **real deployment** running on a Kubernetes cluster.

<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem;margin-top:1.5rem">

![Tenants overview](/screens/03-tenants.png)

![PostgreSQL table browser](/screens/21-postgres-table.png)

![MongoDB document explorer](/screens/19-mongo-documents.png)

![Serverless function invocation](/screens/27-functions-invoke.png)

</div>

> See the full tour in [What is In Falcone?](/guide/what-is-falcone) and build something in the [Quickstart](/guide/quickstart).
