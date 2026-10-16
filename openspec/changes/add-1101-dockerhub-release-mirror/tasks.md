# Tasks

- [x] Verify the assigned issue branch, clean worktree and control-plane risk policy.
- [x] Add failing workflow/preflight fixtures, then implement credential gates and CI coverage.
- [x] Add failing isolated-job/digest fixtures, then resolve GHCR refs within the new Hub job.
- [x] Add failing recording copy fixtures 6a-6k, then implement fail-closed immutable mirroring.
- [x] Add failing latest fixtures 7a-7f, then implement GHCR-authoritative reconciliation.
- [x] Add a failing watcher fixture, then implement loud cancellation recovery.
- [x] Document registry pulls, token rights, visibility, verification and queue overflow recovery.
- [x] Preserve existing GHCR steps, triggers, permissions and build inputs with fixed fingerprints.
- [x] Run scoped workflow and Markdown checks; attempt lint/unit checks and report sandbox limits.
  Full lint cannot start because npm is absent; unit tests require sockets and a sibling charts checkout.
- [ ] Operator after merge: verify the first public six-image release, no-op replay and queued runs.
