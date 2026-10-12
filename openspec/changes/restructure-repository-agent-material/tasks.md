# Phase-1 tasks and deferred gates

## Phase 1

- [x] Verify assigned clean worktree, branch, immutable input and lease identifier.
- [x] Derive tracked top/second/full inventory with Git; classify nested material
  through disjoint recursive rules and record counts and reader citations.
- [x] Record proof that OpenSpec is tracked despite its ignore rule.
- [x] Check only the present GAP-001 manifest subset and record missing entries.
- [x] Record options (a)-(d), decision (d)+(a), complete reader table and allowlist contract.
- [x] Record unresolved external Hermes consumer gates without inventing keys or signoffs.
- [x] Delete only .idea files, ignore /.idea/, extend README and add CONTRIBUTING.
- [x] Force-add the four new OpenSpec files and verify exact path/ignore/scope coverage.
- [ ] PR CI: pnpm lint, pnpm test:unit, blackbox, integration and deploy-docs green.
  Local lint cannot start because npm is absent; workspace dependencies are not
  installed. Socket-dependent tests also require an unrestricted CI environment.
  Local bounded results and exact environmental limits are in the delivery handoff.

## Phase 2 (separate ChangeSet; no implementation here)

- [ ] Owners confirm exact engineering-control config keys and all call sites.
- [ ] Deploy and verify dual-layout Hermes on old and moved immutable revisions.
- [ ] Freeze literal phase-1 head SHA in checker/allowlist; verify eligibility and old blobs.
- [ ] Commit 1: pure git mv; equal blob OIDs/counts; git log --follow proof.
- [ ] Commit 2: bounded reader edits and check-old-paths.sh with negative fixtures.
- [ ] Keep moved spike packages outside pnpm workspace and manifest byte-identical.
- [ ] Require source CI and both-layout Hermes dry-run evidence before phase-2 merge.
- [ ] Retire old-layout support only on owner-confirmed zero-in-flight retirement signal.
