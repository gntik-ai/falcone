## Source implementation

- [x] Verify assigned clean worktree and issue branch.
- [x] Reproduce the realtime gap before changing source.
- [x] Add a shared verified workspace gate and predicate coverage.
- [x] Functions: gate workspace and action reads, deployment and definition export;
      retain mutation, platform-trust and dependency gates.
- [x] Data: gate PostgreSQL and MongoDB data/metadata before connections; preserve
      owner/admin checks and restrict MongoDB metadata counts to authorized workspaces.
- [x] Events: gate workspace and topic-ID routes, including SSE before consumer setup.
- [x] Webhooks/realtime/usage: gate workspace routes, including event-types; preserve
      tenant-addressed webhook validation/configuration precedence.
- [x] Refactor storage through the shared predicate; leave storage regression tests unchanged.
- [x] Add behavioral route coverage with frozen exclusions for existing out-of-scope routes.
- [x] Update authorized test fixtures with verified roles and workspaceIds.

## Validation and delivery

- [x] Complete scoped regression runs; final commit results are recorded in the maker output.
- [x] Create the one local source commit required by the assigned execution contract.
- [ ] Independent checker review, R3 human approval and immutable-image replay
      (control plane; no deployment by the maker).
