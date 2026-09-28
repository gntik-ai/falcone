- [x] Add the strict version-tag push trigger and same-tag workflow concurrency.
- [x] Resolve validated versions and immutable short-SHA tags from event environment values.
- [x] Publish version, SHA, and applicable latest tags in the existing single build-push action.
- [x] Add fail-closed existing-image checks and post-push digest verification.
- [x] Add static black-box coverage for the workflow contract.
- [ ] Verify tag-push and published-release behavior against GHCR after merge with an authorized
  repository identity.
