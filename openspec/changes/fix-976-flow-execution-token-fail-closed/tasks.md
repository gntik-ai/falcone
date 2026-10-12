# Tasks

- [x] Reproduce production fallback acceptance and missing-token activity dispatch at public seams.
- [x] Fail closed in both secret resolvers with a 32-byte production minimum and stable 503 code.
- [x] Require registered activity credentials while retaining the unregistered echo seam.
- [x] Mint cron tokens per firing after checking exact-run Temporal schedule ownership.
- [x] Bound delayed mint expiry to the firing lifetime; support legacy envelope-only Schedule args.
- [x] Clamp mint time to the server firing time when the worker clock lags; retain the expiry cap.
- [x] Authenticate existing capability/wiring fixtures and include them with a worker build in CI.
- [x] Add a deterministic replay patch marker and retain token-free Schedule/visibility metadata.
- [x] Add production parity, API, cron isolation, and production-mode RLS round-trip coverage.
- [ ] Run dependency-backed HTTP/credential/env suites and worker typecheck/build in PR CI.
- [ ] Verify real Temporal cron firing, version skew, and old/new history replay in integration CI.
- [x] Paired deployment: wire one OpenBao/ESO-managed secret to both workloads and readiness gates
  (falcone-charts commit 0a0fd1a290f8d0f07cfc70ee0cb5fa293c63b4c3, independently checked).
- [ ] Release gate: immutable image digests, chart assertions, redacted replica presence evidence,
  forged-dev-token rejection, R3 human approval, and independent dual-provider review.

## Checker follow-up evidence

Before the fix, `node tests/blackbox/flows-execution-token-trust.test.mjs` failed the
clock-skew regression: a worker clock five seconds behind the server firing produced
`cron firing time is invalid or expired`. Clamping mint time passes that regression while
preserving the expiry bound and foreign-owner rejection. The catalog email, database wiring
(01/02), and LLM completion tests also reproduced `EXECUTION_TOKEN_INVALID` with the Temporal
boundary adapter before their tenant envelopes were given valid executor-minted tokens.

The offline adapter now preserves Temporal ApplicationFailure's name, so already-classified
capability failures pass through the real database activity unchanged. PR CI uses the real SDK.
Offline dependency-backed suites remain pending: credential helpers need `yaml`; HTTP/memo
and env round-trip suites need `pg`; full database wiring needs the compiled worker. Local pnpm
typecheck/build cannot start because spawning Node returns EPERM, and node_modules are absent.
No dependency manifests or lockfiles changed. Live Temporal firing/replay, authorizer describe
permission, image digests, and release approval remain integration/release obligations above.

## Source revalidation after deployment-only findings

Reviewed source HEAD `172a47c4b36bc2ebb10839a675090f82db90d8f6` in the assigned clean
issue-976 worktree. The new checker findings belong to falcone-charts; no further source fix
was identified. Preserve the existing implementation and its red-before-green evidence above.
This follow-up changes only this handoff; dependency manifests, lockfiles, and chart pins remain
unchanged.

The production-secret and execution-token-trust blackbox suites pass offline. The latter's nine
cases cover missing/null credentials, production executor/worker parity, late cron firings,
clock skew, exact-run schedule ownership, expiry bounds, echo behavior, and the replay patch seam.
The executor and worker secret resolvers remain byte-equivalent and minting stays in activities.

The dependency-backed checks could not start: execution-credentials requires `yaml`;
activity-token-gate, activities, worker-db-activity-wiring, and llm-complete-activity require
`@temporalio/activity`; execution-token-not-in-memo and the env credential round-trip require
`pg`. Worker typecheck and build both stop at `spawnSync /usr/local/bin/node EPERM`.
These are sandbox skips, not assertion failures. PR CI must run those checks with installed
dependencies; live Temporal firing/replay and all paired deployment/release gates remain pending.
