## Context

Three server sources land manifests (instant #392, custom #394, official #391) and curation (#393) decides the served tool set. Nothing today **pins** what was approved or **detects** a silent change on a new version. MCP's rug-pull risk makes this a `security`/P1 gap. Falcone already enforces an image supply-chain policy for its own deployables (`scripts/lib/quality-gates.mjs`: digest `sha256:…`, no `latest`, semver-ish tag) and `mcp-custom-hosting` (#394) already parses + pins image refs — this change reuses both rather than inventing a new policy.

## Goals / Non-Goals

**Goals:** a pure, deterministic registry (`register → diff → review/approve → activate`, plus rollback); a deploy-time supply-chain gate (pinned + allowed registry + verified signature); tenant-scoped entries.

**Non-Goals:** the cosign binary itself (injected adapter, ADR-4); a public marketplace; the console review UI (#397); the running NetworkPolicy isolation proof (#399).

## Decisions

- **Version = (digest, manifest, source, signature verdict).** A registry entry is keyed by `(tenantId, serverId)` and holds an ordered `versions[]`. Each version pins an **immutable digest** — a tag alone is never enough to register. Rationale: the digest is the only rug-pull-proof identity.
- **Supply-chain gate is one pure predicate.** `verifyImageForDeploy({ image, signatureVerified, allowedRegistries, requireSignature })` returns `{ ok, violations }`, reusing `parseImageRef`/`isPinnedImage` and mirroring the image-policy violations (`image_not_pinned`, `registry_not_allowed`, `signature_unverified`). The actual signature check is performed by an injected verifier (cosign adapter) whose boolean verdict is passed in — the registry **enforces** it; it does not shell out.
- **Review gate keys on tool-facing changes only.** `diffVersions(prev, next)` compares the curated tool sets and reports `added`, `removed`, and `changed` (description or scope deltas). If any are present, the new version is `requiresReview: true` and `activateVersion` refuses to serve it until `approved: true`. A pure config/digest change with identical tools needs no review. Rationale: the agent's contract is the tool descriptions/scopes — that is exactly what must not silently drift.
- **Rollback is re-activation, not re-deploy.** `rollbackToVersion` activates an already-approved prior version by its retained digest; no re-review (it was approved before). Only one version is `active` at a time.
- **Tenancy.** Every accessor takes `tenantId` and filters by it; a lookup with the wrong tenant returns `null`/empty — never another tenant's entry (ADR-2; hardened by RLS/NetworkPolicy under #399).

## Risks / Trade-offs

- *Signature verification is modeled, not executed here* → the verdict is injected and **enforced**; the cosign adapter + admission wiring is the deploy-path follow-up (kept out so this change stays a pure, fully-tested core).
- *Diff granularity* → start with tool name/description/scope (the agent-visible contract); deeper input-schema diffing can extend `diffVersions` later without changing the gate.

## Migration Plan

Additive: a new pure module + tests. Registries are created on first publish; existing servers register their current manifest as v1 (digest-pinned) when this lands. No data migration.

## Open Questions

- Whether input-schema changes (not just description/scope) should also trip the review gate — likely yes in a follow-up; the diff structure already has room.
- Where approval is recorded (per-tenant audit, #398) and surfaced (console, #397).
