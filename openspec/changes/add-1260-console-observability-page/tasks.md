# Tasks

- [x] Add the lazy `observability` dispatch and the migrated flag.
- [x] Add the page-local request module for the nine listed endpoints and no others.
- [x] Load metrics (overview, usage, windowed workspace series) and the first audit page on arrival.
- [x] Render the series chart-card with its toggle hidden, the dimension meters, quota posture link and tenant-scope disabled window.
- [x] Render the audit table, filters, load-more footer with failure retry, and the detail drawer.
- [x] Render export progress, manifest, unavailable and failed states; retry re-posts the failed body.
- [x] Key audit, cursor, drawer and export state to scope and filters and ignore superseded responses.
- [x] Hide the Auditoria tab and send no audit request without `tenant.audit.read`.
- [x] Carry the `not_enforced` dimension badge from the legacy page.
- [x] Add complete es/en resources, announcements and in-page 403 and 404 states.
- [x] Add Vitest, routing and rollback coverage, including stale-response cases.
- [x] Add the parity manifest, spec and inventory (D1-D13) for es and en at 375, 768 and 1280 px.
- [x] Update the `platform_auditor` heading in `tests/shell.test.tsx` and register the reads in the landing suites.
- [ ] Complete independent checker review.
- [ ] Run parity, axe, viewport and CSP browser gates in PR CI (Chromium is unavailable in the maker sandbox).
- [ ] Review CI visual baselines and obtain operator approval before delivery.

MCP validate_page is unavailable in this environment. Kit conformance uses the Hermes-pinned
gntik-ui 0.11.0 snapshot and the repository colour and i18n checks.
