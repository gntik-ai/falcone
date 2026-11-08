# Tasks

- [x] Add the lazy page, the migrated flag and the es/en namespace.
- [x] Port the six legacy calls with identical method, path and payload shape.
- [x] Build the list, create form, row actions and credential status tags.
- [x] Add typed confirmations for rotation, revocation and deletion.
- [x] Add the masked reveal disclosure and the fresh-secret disclosure with copy fallback.
- [x] Add per-surface failure handling, retry, precheck after network failure and focus rules.
- [x] Add the context-switch reset, stale response discard and workspace gates.
- [x] Port the legacy tests and add component, request, route and rollback coverage.
- [x] Add the parity manifest, the twelve-cell journey (tenant_owner and tenant_viewer), the legacy comparison in every owner cell and the inventory.
- [x] Localize the read-only role label and deny reason through the page catalog.
- [ ] Run browser parity, axe, short-viewport and CSP gates in PR CI.
- [ ] Obtain operator review of the CI visual baselines and R3 approval.
- [ ] Independent checker review before merge.

MCP validate_page is unavailable in the delivery sandbox; the pinned kit snapshot,
the colour lint and the repository checks stand in. Chromium cannot launch there, so
every browser run is left to PR CI and no screenshot is claimed.
