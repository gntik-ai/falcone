# Quotas migration evidence

Page: `console-quotas-page`, blueprint SHA256 `d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d`.
Approved entry SHA256: `1bf089787d3b2976b069b3b4b18ab79cf43b6b15b5f0bd754e60f0e44b2c0f58`.
Assigned branch/worktree suffix: `1729a9e2-97bc-5491-80ba-a552deb02417`.
Delivery base: `6cc5294430f46938cdf8bea5b1529b2dfc95d406`.
Kit: the supplied Hermes snapshot `96be88e0cd7cf2c69288303e5e4514bfe30d4ee21b6162c4d111ee44aa0b85e1`, packages pinned to 0.11.0. No MCP server is configured, so validate_page cannot run.

The resource-index page uses the Page layout and explicit page-header, section-header, page-toolbar, skeleton and error slots. The data-table slot composes kit Table primitives, as the allocation migration does: 0.11.0 DataTable wraps every body cell in td and cannot supply the required scope=row headers. Selection, pagination, bulk actions, view, density and column menus are absent. All collection data and visible labels come from the API or the two catalogs. Table overflow stays in the kit scroll container.

The six transport functions in packages/console-api/src/clients.ts preserve the four legacy metrics reads, tenant-plan resolution and plan-limit PUT, without query parameters. The PUT body contains only value. The tenant metrics pair precedes the optional workspace pair, as in the legacy hook. Every request uses the shared session transport, including its one-refresh authorization behavior.

The legacy closure delta was inspected from fecb3a03e1c1920ebc4bd760d3348a4831cd80df to the delivery base. Shared console-api transport/context/session integration and role semantics are retained. The additional not_enforced policy mode renders the unchanged Spanish “No aplicada” label. The history and lifecycle client additions are unused by this page and produce no requests. No legacy source or test is edited.

The manifest exports the ten approved intended differences. The page tests cover platform_operator and plain-member permissions without changing the parity harness Role union. The browser journey covers both harness roles, both locales and 375/768/1280 widths. Additional synthetic session roles cover operator and member rendering. Screenshots are attached with SHA256 names for independent checker and operator review; local visual approval is not claimed.

Rollback tests replace the quotas route element with the existing unguarded pending element (the result of removing its router branch) and clear its migrated flag. They exercise direct, fixture NavLink and navigate entry paths, assert the legacy sidebar href, and reject reachable metrics or limit requests.

The source change does not publish gateway routes or alter backend authorization. Publication of the plan-limit route remains a rollout prerequisite outside this source-only ChangeSet. The legacy platform_operator action remains visible and can receive a backend 403.

Checker follow-up: unmapped overview posture values retain the legacy underscore-to-space fallback instead of becoming Unknown. The default overview fixtures now use the live handler's critical/healthy vocabulary; unit and parity cases also cover the documented enum values. Known labels and status tones stay unchanged. An empty workspace retains its zero-dimension count and empty table; the no-results state and clear action appear only after entering a search. Both cases have es/en unit coverage and browser assertions, with screenshot capture for the corrected states. Browser execution and screenshot approval remain pending in the checker/CI environment because Chromium is unavailable in the maker sandbox.
