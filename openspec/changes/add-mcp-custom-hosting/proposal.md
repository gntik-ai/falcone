## Why

Power users will bring their own MCP server. Falcone should **host** it — runtime, gateway, OAuth, a domain and observability — so a tenant gets all the platform guarantees without operating any infrastructure. The common ingest is a **container image** (git push / CLI build resolve to an image); Falcone lands it on the existing runtime as a tenant-namespaced, internal-only, scale-to-zero workload. It resolves issue **#394** (epic #386); builds on the runtime (#388), gateway (#389), OAuth (#390), registry/supply-chain (#396) and CLI (#400).

## What Changes

- A **custom-server deployment-spec builder**: given `{ tenantId, serverId, image, ... }`, produce the **Knative Service (ksvc)** to host the tenant's own MCP server:
  - in the tenant's namespace, labeled **`in-falcone.io/component: mcp-server`** so the #388 NetworkPolicy makes it **internal-only** (reachable only via the gateway),
  - **OpenShift-safe** securityContext (non-root, no privilege escalation, dropped caps, RuntimeDefault seccomp),
  - **scale-to-zero** (min-scale 0) — idle custom servers cost nothing,
  - a readiness probe + the tenant/server env.
- **Supply-chain validation** (feeds #396): the image must come from an **allowed registry** and be **pinned** (a digest or a non-`latest` tag) — unpinned/`latest` or disallowed-registry images are rejected.
- Ingest paths: **container image** (the core, implemented here), plus **git push / CLI** which build to an image and then deploy the same way (#400 CLI; build pipeline).
- On deploy, the platform auto-wires the gateway route (#389), the OAuth client/scopes (#390) and observability (#398).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `mcp`: add custom (bring-your-own) server hosting — deploy a tenant-provided, supply-chain-validated image as an internal-only, tenant-scoped, scale-to-zero MCP server. Builds on the foundational `mcp` capability (#387) and the runtime (#388).

## Impact

- **Control-plane:** `apps/control-plane/src/mcp-custom-hosting.mjs` (pure deploy-spec builder + validation) + tests. The actual apply (creating the ksvc) rides the runtime RBAC (#388) and Knative.
- **Reuses:** the #388 NetworkPolicy label contract + ksvc pattern, the gateway route (#389), OAuth (#390); supply-chain checks align with the image-policy validator and the registry (#396).
- **Out of scope:** the git/CLI build pipeline internals (#400 CLI); registry storage/signing internals (#396); the Connect UX (#397).
