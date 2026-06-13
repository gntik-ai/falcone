## 1. Registry + versioning core

- [x] 1.1 `createRegistry()` / `registerVersion(reg, {tenantId, serverId, version, image, manifest, source, signatureVerified})` — requires a digest-pinned image; records the version under `(tenantId, serverId)`; tenant-scoped accessors `getServer(reg, tenantId, serverId)` / `listVersions` that never cross tenants
- [x] 1.2 `diffVersions(prev, next)` → `{ added, removed, changed }` over tool name/description/scope; `requiresReview` true iff any tool-facing change
- [x] 1.3 `activateVersion(reg, tenantId, serverId, version, {approved})` — refuses a `requiresReview` version unless `approved`; exactly one active version; `rollbackToVersion` re-activates a prior approved version (no re-review)

## 2. Supply-chain gate

- [x] 2.1 `verifyImageForDeploy({image, signatureVerified, allowedRegistries, requireSignature})` → `{ ok, violations }` reusing `parseImageRef`/`isPinnedImage` (#394), mirroring image-policy rules (unpinned / `latest` / registry-not-allowed / signature-unverified)

## 3. Verify

- [x] 3.1 Unit tests (9/9): register requires digest; tenant-scoped read isolation (cross-tenant probe returns nothing); diff detects added/removed/changed desc+scope; review gate blocks unapproved bump then serves on approval; rollback re-activates without review; deploy gate rejects unsigned + unpinned + disallowed-registry
- [x] 3.2 `pnpm lint` + `openspec validate --strict` pass

## 4. Finalize

- [x] 4.1 Signature verification is an injected verdict (cosign adapter, ADR-4) that the registry RECORDS and ENFORCES (no shell-out here); deeper input-schema diffing and the console review surface (#397) are noted follow-ups in design.md
