# Proposal: Mirror release images to Docker Hub by GHCR digest

## Why

Release images are only published to GHCR. Operators also need public Docker Hub references
under `docker.io/gntik`, preserving the exact manifests and immutable release tags.

## What changes

- Gate builds with a Docker Hub credential check and login, without broadening workflow permissions.
- Replace workflow concurrency with separate GHCR and Hub per-image queues, using `queue: max`
  and `cancel-in-progress: false`. Report cancelled runs through a permission-free watcher.
- Mirror the existing six-image matrix in an isolated, read-only GitHub-permission job after
  GHCR verification, with a 30-minute timeout. Keep all existing build steps byte-identical.
- Resolve the source digest from both GHCR immutable tags. Inspect both Hub tags before writes,
  reject conflicts, check dry-run bytes, copy missing tags only, and verify digests and visibility.
- Reconcile Hub `latest` only from observed GHCR `latest`, including skip/re-run paths. Re-read
  GHCR after writes and fail loudly on races.
- Run extracted-script fixtures unconditionally in quality CI and document operator recovery.

## Non-goals

No chart/deployment changes, rebuilds for Hub, release execution, token rotation, repository API
mutation, multi-arch builds, signing, provenance or SBOM changes. Triggers, GHCR refs, labels,
build inputs and the existing secret allowlist remain unchanged.

## Impact and rollback

The control plane assigns R1 to this bounded source ChangeSet; the issue's R3 label is superseded
by that supplied risk policy. The approved OpenSpec includes this change directory in addition to
the six workflow/test/documentation files. No merge, deployment or registry operation is performed
by implementation. Revert the source change to roll back; existing Hub tags remain independent
of GHCR and Helm. Invalid credentials still block GHCR by design; repository problems only fail
the isolated Hub job and recover through a re-run after operator correction.

GitHub documents `queue: max` and the 100-pending limit in
[workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).
Live publication and scheduler behavior remain post-merge operator checks.
