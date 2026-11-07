# Tasks

- [x] Add conditional lazy dispatch and the members migration flag.
- [x] Implement complete users loading, dedupe, cursor guard and independent roles.
- [x] Preserve account creation, role gating and invitation lifecycle requests.
- [x] Build the four-step kit wizard, quota gate and ephemeral proof handling.
- [x] Add es/en labels, states, validations and announcements.
- [x] Add component, request, route, rollback and parity fixture coverage.
- [x] Cover the named visual states in es/en at 375, 768 and 1280 px.
- [x] Run local tests, static checks and production build.
- [ ] Complete independent checker review and confirm blockers before merge.
- [ ] Run browser parity, axe, viewport and CSP gates in PR CI.
- [ ] Obtain operator review of CI visual baselines and R3 approval.

MCP validate_page is unavailable; use the supplied pinned kit snapshot and
repository checks. No screenshots are claimed from this sandbox.

The scoped members/routing/rollback checks pass (46 tests), as do legacy members
(19), console-api (52), separate shell fixtures (3), production build and static
gates. Delivery output records the final normal-suite result. Browser execution
and operator review remain pending as listed above.
