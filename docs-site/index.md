---
layout: home

hero:
  name: In Falcone
  text: Multi-tenant Backend-as-a-Service
  tagline: Postgres, FerretDB-backed document data, object storage, events, serverless functions, realtime, Flows, and MCP behind one gateway with tenant-scoped identity.
  image:
    src: /img/logo-wide.png
    alt: In Falcone
  actions:
    - theme: brand
      text: Start as a user
      link: /personas/non-expert
    - theme: alt
      text: Install as an operator
      link: /personas/operator
    - theme: alt
      text: Build as a developer
      link: /personas/developer

features:
  - title: Non-expert user path
    details: Start with what the platform gives you, how tenants and workspaces fit together, and the shortest kind-based route to a running console.
    link: /personas/non-expert
    linkText: User path
  - title: DevOps and operator path
    details: Install the full umbrella Helm chart on Kubernetes or OpenShift, choose Ingress or Route exposure, verify readiness, and plan scaling and backups.
    link: /personas/operator
    linkText: Operator path
  - title: Developer path
    details: Use the current runtime and contracts for tenants, workspace environments, service accounts, functions, data APIs, events, realtime, Flows, and MCP.
    link: /personas/developer
    linkText: Developer path
  - title: Kubernetes and OpenShift
    details: The chart renders Ingress on Kubernetes and OpenShift Routes with restricted-v2-compatible values on OpenShift.
    link: /operations/openshift-install
    linkText: OpenShift install
  - title: Public API surface
    details: Public HTTP routes are grounded in the generated OpenAPI, gateway route catalog, and runtime route tables.
    link: /api/control-plane
    linkText: API reference
  - title: Backup and restore
    details: Tenant-level restore workflows are documented alongside platform backup scripts for Helm, Secrets, OpenBao/ESO, and rollback evidence.
    link: /operations/backup-restore
    linkText: Backup guide
---

::: danger Not production-ready
**In Falcone is in early, active development.** Public APIs, data schemas and runtime behavior
may change at any time, without notice or a migration path; there are no stability, security or
support guarantees; and the project has not undergone a security audit. **Do not use it for
production workloads or sensitive data** - evaluation, experimentation and development only. See
the [Roadmap](/guide/roadmap).
:::

## Choose your path

| Persona | Start here | You will get |
| --- | --- | --- |
| I want to try Falcone without becoming a platform expert. | [Non-expert user](/personas/non-expert) | A kind cluster, a running platform, console access, and a first tenant/workspace. |
| I operate Kubernetes or OpenShift. | [DevOps / operator](/personas/operator) | Helm values layering, Kubernetes install, OpenShift Route/SCC guidance, Harbor/air-gap notes, readiness, scaling, and backups. |
| I build on the API. | [Developer](/personas/developer) | Current API shape for tenants, workspace environments, service accounts, functions, data APIs, events, realtime, Flows, and MCP. |

## A first look

In Falcone ships with a web console for tenant administration and data exploration. The screenshots
below are from a real Kubernetes deployment.

<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem;margin-top:1.5rem">

![Tenants overview](/screens/03-tenants.png)

![PostgreSQL table browser](/screens/21-postgres-table.png)

![Document explorer (FerretDB-backed)](/screens/19-mongo-documents.png)

![Serverless function invocation](/screens/27-functions-invoke.png)

</div>

Continue with the [kind quickstart](/guide/quickstart), the [Kubernetes install](/operations/kubernetes-install),
or the [OpenShift install](/operations/openshift-install).
