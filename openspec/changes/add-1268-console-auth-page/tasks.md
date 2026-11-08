# Tasks

- [x] Add the lazy page, the migrated flag, the superadmin guard branch and the es/en namespace.
- [x] Port the legacy requests, payload builders and validators with identical method, path, query and body.
- [x] Build the realm summary, scope and client tables and the connection snippets.
- [x] Build the applications toolbar, list, forms, provider panel and destructive confirmations.
- [x] Build the IAM client wizard with the permission gate, the review step and secret-free handling.
- [x] Add per-section failure handling (no-access, not-found, retry rules) and the reload rule.
- [x] Port the legacy tests and add request-count, secret non-leak, permission and routing coverage.
- [x] Add the parity manifest, fixtures, journey spec and inventory.
- [ ] Run browser parity, axe, locale, responsive and CSP gates in PR CI.
- [ ] Operator review of the CI visual baselines and R3 approval.
- [ ] Independent checker review before merge.

MCP `validate_page` is unavailable in the delivery sandbox; the pinned kit snapshot, the colour lint
and the repository checks stand in. Chromium cannot launch there, so every browser run is left to PR CI.
