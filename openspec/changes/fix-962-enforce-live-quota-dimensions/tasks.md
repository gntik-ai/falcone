# Tasks

- [x] Verify clean worktree and assigned issue branch identity.
- [x] Add a generic dimension gate with the runtime loader and `opts.load` seam.
- [x] Gate tenant-wide topics, distinct Mongo names and Function creation before writes.
- [x] Resolve tenant storage byte limits and gate PUT and multipart completion.
- [x] Bound paginated metering, handle replacements and report tenant usage limits.
- [x] Preserve workspace and bucket gates, fail-open availability and best-effort logging.
- [x] Mark ungated dimensions `not_enforced` in posture, API schema and console labels.
- [x] Add precedence/boundary, unlimited, exception and no-side-effect handler coverage.
- [x] Preserve existing workspace/storage quota suites unchanged; update the older
  multipart regression for catalog-backed 402 admission before assembly.
- [x] Generate metrics family schema from the canonical API document.
- [x] Include the generic gate in the control-plane image and add quota handler CI coverage.
- [x] Run 208 assertions across 18 scoped suites (148 with normal Node imports,
  60 using temporary throwing Kafka/Mongo import stubs and injected backend fakes).
- [x] Check changed JavaScript syntax, JSON parsing, schema parity and Git whitespace.
- [ ] CI: run Kafka/Mongo handler tests with installed driver packages (offline runs
  use throwing import stubs and injected clients; no driver integration is claimed).
- [ ] CI: run normal public API validation/generation, console typecheck/tests and
  Markdown lint with installed dependencies. `yaml`, TypeScript, Vitest and
  markdownlint are absent in this offline worktree; the installed pnpm executable
  also hits a sandbox EPERM while spawning Node. The additional storage traversal
  regression requires absent `cel-js` and is deferred to CI.
- [ ] Runtime checker: reproduce topic 11 and distinct Mongo database 3 refusals,
  verify default-source enforcement rows and measure actual tenant storage scan latency.
