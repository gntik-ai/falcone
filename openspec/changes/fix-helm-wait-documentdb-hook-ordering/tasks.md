# Tasks — fix-helm-wait-documentdb-hook-ordering

## Investigation
- [ ] Identify the post-install hook that creates the `documentdb_api` schema.
- [ ] Map the FerretDB readiness probe's dependency on that schema.

## Implementation
- [ ] Convert the schema-creation step to a pre-install hook (runs before main
  resources) or an init-container on the FerretDB pod.
- [ ] Verify `helm install --wait` converges end-to-end on kind.
- [ ] Ensure the hook is idempotent (safe to re-apply on upgrade).

## Verification
- [ ] `helm install --wait` on a fresh kind cluster completes without timeout.
- [ ] FerretDB reaches `Running` without manual intervention.
- [ ] Run `/opsx:verify fix-helm-wait-documentdb-hook-ordering`.

## Archive
- [ ] `/opsx:archive fix-helm-wait-documentdb-hook-ordering`
