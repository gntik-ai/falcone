## Context

ADR-12 hosts MCP servers as Knative ksvcs in the tenant namespace (proven in the #387 spike: serves MCP over Streamable HTTP + scale-to-zero). The #388 chart ships the per-tenant NetworkPolicy that makes pods labeled `in-falcone.io/component: mcp-server` internal-only, and the RBAC for the control-plane to create ksvcs. Custom hosting reuses all of that: a tenant's own image becomes such a ksvc.

## Goals / Non-Goals

**Goals:** a pure, tested builder that turns a custom-server spec into a correct, internal-only, scale-to-zero, OpenShift-safe ksvc; supply-chain validation (allowed registry + pinned image).

**Non-Goals:** the git/CLI build pipeline (#400 builds the image, then deploys via this builder); registry storage + signing internals (#396); gateway/OAuth wiring (#389/#390 — invoked on deploy, not re-implemented here).

## Decisions

- **Image is the deploy unit.** git push / CLI builds resolve to an image; this builder takes an image ref. Rationale: one deploy path; the build pipeline is orthogonal (#400). 
- **Reuse the #388 label contract + ksvc pattern.** The ksvc carries `in-falcone.io/component: mcp-server` (so the #388 NetworkPolicy selects it → internal-only), `min-scale 0` (scale-to-zero), OpenShift-safe securityContext. No new runtime.
- **Supply-chain validation at build-spec time.** Reject images not from an allowed registry, and reject unpinned/`latest` tags (a `latest` tag is mutable → rug-pull risk). Digest pinning is preferred; this aligns with the image-policy validator and the registry (#396). *Alternative:* allow any image — rejected (supply-chain risk; the whole point of hosting is platform guarantees).
- **Tenant-scoped by construction.** The ksvc lands in the tenant's namespace with tenant/server labels; the tenant is never taken from request input at deploy time.

## Risks / Trade-offs

- *Malicious tenant image* → internal-only NetworkPolicy + egress controls (#388/#399) bound blast radius; supply-chain validation + signing (#396) gate what can run; OpenShift-safe securityContext (non-root) limits the container.
- *Resource abuse* → per-plan resource limits + quotas (#399) on the ksvc.

## Migration Plan

Additive: pure builder + tests now; wired into a deploy route + the CLI (#400) later. Custom servers are torn down by the MCP teardown applier (#388) on tenant purge.

## Open Questions

- Allowed-registry policy source (per-tenant registry vs platform Harbor) — align with #396.
- Whether to require cosign signature verification at deploy (vs registry admission) — #396 decides; the builder exposes the hook.
