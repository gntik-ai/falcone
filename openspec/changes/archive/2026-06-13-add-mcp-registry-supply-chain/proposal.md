## Why

MCP's signature risk is the **"rug pull"**: a server (instant #392, custom #394, official #391) can silently change a tool's behavior, description, or scope between versions, and an agent keeps calling it. Falcone needs a **per-tenant server registry** that pins each version by **immutable digest**, **verifies image signatures at deploy** (aligned with the existing image supply-chain policy, `validate:image-policy` / `pnpm security:images`), and **gates a version bump** behind explicit tenant review when a tool's description or scope changes — plus **rollback** to a known-good pinned version. This resolves issue **#396** (epic #386).

## What Changes

- **Per-tenant server registry**: each MCP server has an ordered set of **versions**, each carrying its manifest (curated tool set #393), `source` (`instant`/`custom`/`official`), a **pinned image digest**, and a signature-verification record. Registry entries are **tenant-scoped** — a cross-tenant read resolves to nothing.
- **Supply-chain gate at deploy**: `verifyImageForDeploy` rejects an image that is **unpinned** (`latest`/tag-only when a digest is required), from a **registry not on the allow-list**, or whose **signature did not verify** — reusing `parseImageRef`/`isPinnedImage` (#394) and mirroring the image-policy rules.
- **Version-bump review gate**: `diffVersions(prev, next)` surfaces **added/removed tools and changed descriptions/scopes**; if anything tool-facing changed, the new version is marked **`requiresReview`** and **must not serve traffic** until a tenant **approves** it (`activateVersion` refuses to activate an unapproved, review-required version).
- **Rollback**: `rollbackToVersion` re-activates a previously pinned version (its digest is retained), with no re-review needed because it was already approved.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `mcp`: add a per-tenant **server registry with versioning and supply-chain controls** — digest-pinned versions, signature verification at deploy, a description/scope-change review gate on version bumps, and rollback. Builds on the foundational `mcp` capability (#387), curation (#393) and custom hosting (#394).

## Impact

- **Control-plane:** `apps/control-plane/src/mcp-registry.mjs` (pure registry + version-diff + supply-chain gate + rollback) + tests. Reuses `mcp-custom-hosting`'s `parseImageRef`/`isPinnedImage` and mirrors `scripts/lib/quality-gates.mjs` image rules.
- **Integrations:** consumes curated manifests from `mcp-curation` (#393), governs the deploy of custom (#394) / instant (#392) / official (#391) servers; surfaced for review in the console (#397); tenant isolation hardened under #399.
- **Out of scope:** a cross-tenant public marketplace; the actual cosign binary call (an injected verification adapter, ADR-4 — the registry records and enforces its verdict).
