# Tasks

- [x] Reproduce production fallback acceptance and missing-token activity dispatch at public seams.
- [x] Fail closed in both secret resolvers with a 32-byte production minimum and stable 503 code.
- [x] Require registered activity credentials while retaining the unregistered echo seam.
- [x] Mint cron tokens per firing after checking exact-run Temporal schedule ownership.
- [x] Bound delayed mint expiry to the firing lifetime; support legacy envelope-only Schedule args.
- [x] Add a deterministic replay patch marker and retain token-free Schedule/visibility metadata.
- [x] Add production parity, API, cron isolation, and production-mode RLS round-trip coverage.
- [ ] Run dependency-backed HTTP/credential/env suites and worker typecheck/build in PR CI.
- [ ] Verify real Temporal cron firing, version skew, and old/new history replay in integration CI.
- [ ] Paired deployment: wire one OpenBao/ESO-managed secret to both workloads and readiness gates.
- [ ] Release gate: immutable image digests, chart assertions, redacted replica presence evidence,
  forged-dev-token rejection, R3 human approval, and independent dual-provider review.
