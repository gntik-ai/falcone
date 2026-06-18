# Tasks — add-seaweedfs-per-tenant-identities

> STATUS: the scaffolding slice (builder + chart creds) shipped in #574. This change now
> implements the LIVE closure — filer-based dynamic IAM + per-workspace identity issuance
> at provision time — so a tenant gets a bucket-scoped credential and the shared admin key
> is no longer the only credential.

## Reproduce (test-first)
- [x] `tests/blackbox/seaweedfs-per-tenant-identities.test.mjs` (builder) + `tests/blackbox/seaweedfs-workspace-identity-issuance.test.mjs` (bbx-553-01..05, the runtime issuer): RED before `seaweedfs-identity.mjs` existed; GREEN after. Assert the issued identity is scoped to ONLY its bucket (no wildcard/Admin), DNS-safe name, fail-closed on empty bucket, and the issue flow posts the seed Job + returns the one-time credential.

## Implement
- [x] DEPLOY (filer-mode): `charts/in-falcone/values.yaml` → `seaweedfs.s3.enableAuth: false` (drops the static `-config` so the gateway reads IAM from the FILER) + `extraArgs: ["-iam.readOnly=false"]`. A static `-config` gateway IGNORES filer identities (verified live: scoped key → InvalidAccessKeyId), so it is incompatible with per-tenant onboarding.
- [x] DEPLOY (admin seed): new `charts/in-falcone/templates/seaweedfs-admin-seed-hook.yaml` post-install/upgrade Job seeds `falcone-s3-admin` (the backend `STORAGE_S3_*` credential, from `in-falcone-seaweedfs-s3-creds`) into the filer so the gateway still authenticates it and the filer is never empty/anonymous. Pod labelled `app.kubernetes.io/name: seaweedfs` to pass the master/filer NetworkPolicies.
- [x] RUNTIME (kind): new `deploy/kind/control-plane/seaweedfs-identity.mjs` — `issueWorkspaceIdentity()` runs a one-shot k8s Job (`weed shell s3.configure -apply`, reusing the control-plane SA's existing `batch/jobs` RBAC) to seed a bucket-scoped identity; the filer-mode gateway picks it up dynamically (no restart). Wired into `storage-handlers.mjs::storageProvisionBucket` (best-effort, returns the one-time credential), gated by `STORAGE_TENANT_IDENTITIES=1`. Module added to the control-plane Dockerfile COPY; env set in `deploy/kind/values-kind.yaml`.
- [x] PRODUCT: already complete — `wf-con-003-workspace-creation` calls `provisionWorkspaceStorageBoundary` (storage-tenant-context) which builds + writes the scoped identity via the weed-shell transport; reused, not rebuilt.

## Verify
- [x] Black-box 770 green (5 new issuer scenarios); CI subset green (unit 707 / adapters 142 / contracts 232); `helm template` renders the whole chart (s3 filer-mode + admin-seed hook).
- [x] LIVE mechanism PROVEN (de-risk, kind test-cluster-b 2026-06-18): a filer-mode gateway with a bucket-scoped identity → the scoped key PUTs/LISTs its OWN bucket and gets **AccessDenied** on another tenant's bucket; the broad admin key reaches both. `weed shell s3.configure -apply` writes + the gateway reloads dynamically.
- [x] LIVE end-to-end cutover PROVEN (kind test-cluster-b 2026-06-18): seeded the admin into the filer + cut the s3 gateway to filer-mode (`-config` dropped, `-iam.readOnly=false`) — the backend admin key still authenticates (created+listed a bucket, no storage regression) and anonymous is DENIED. Redeployed the control-plane with the issuer (`STORAGE_TENANT_IDENTITIES=1`); `POST /v1/storage/workspaces/{ws}/buckets` → 201 with a `storageCredential` (identity `falcone-ws-<wsId>`, actions Read,Write,List). The issued scoped key PUTs/LISTs its OWN bucket and gets **AccessDenied** on another tenant's bucket. #553 acceptance met.

## Archive
- [x] `openspec validate add-seaweedfs-per-tenant-identities --strict` → valid. Archive after PR #575 merges (closes #553).
