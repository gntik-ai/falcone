# Tasks

- [x] Add the lazy superadmin-guarded `plans/:planId` dispatch and the migrated flag.
- [x] Load the plan and its limits in parallel; render loading, 401, 403, 404 and load error states.
- [x] Compose header, stepper, tabs, description list, one-entry timeline, capabilities and assignments.
- [x] Compose the limits table with number inputs, Enter and Escape rules and the required validations.
- [x] Send lifecycle, delete and limit requests through console-api; never replay lifecycle POST or plan DELETE after 401.
- [x] Compose the typed-name AlertDialog and the destructive alert dialogs from page catalog copy.
- [x] Render mutation 403 no-access, 5xx and network error panels and Reintentar with identical re-send.
- [x] Add the lost lifecycle response copy and the accepted-then-reload-failed reconciliation.
- [x] Add complete es/en resources, toast and live announcements.
- [x] Add Vitest, routing and rollback coverage.
- [x] Add the parity manifest, spec and inventory for es and en at 375, 768 and 1280 px.
- [x] Register only the two plan-detail reads in the shared fixture registries.
- [ ] Complete independent checker review.
- [ ] Run parity, axe, viewport and CSP browser gates in PR CI (Chromium is unavailable in the maker sandbox).
- [ ] Review CI visual baselines and obtain operator approval before delivery.

MCP validate_page is unavailable in this environment. Kit conformance uses the Hermes-pinned
gntik-ui 0.11.0 snapshot and the repository colour and i18n checks.
