# Tasks

- [x] Verify the assigned clean source worktree and issue/run branch against base `e2175722f0d9ca2e98dcf43f1d05b2a9f08bfcc0`.
- [x] Reproduce the anon write issuance bypass twice through the real store before changing source.
- [x] Run failing store tests before each source slice: anon write rejection, malformed scopes and legacy rotation without revocation.
- [x] Enforce the declared ceilings before issuance queries or key generation, preserving defaults and service subsets.
- [x] Reject legacy over-scoped rotations before revoking the original; preserve compliant type and scopes.
- [x] Add public HTTP and MCP coverage using the real executor and Node HTTP parser with an in-memory network boundary.
- [x] Correct anon/RLS documentation and record the compatibility change and existing-key limitation.
- [x] Run final bounded checks and include this handoff in one local source commit.
- [ ] PR CI: rerun the four unchanged socket-based regression suites after publication.
- [ ] Integration: optionally verify over-scoped anon mint rejection against real PostgreSQL.

## Evidence

The assigned path and branch `agent/falcone/1011/250886b3-40d1-54fa-9c84-2a68091fbb7d` match the supplied source lease. Initial tracked and untracked status was clean. No local AGENTS.md or GLOSSARY.md was present; the supplied execution contract and R2 policy bound this work.

RED: `node tests/unit/api-keys-scope-ceiling.test.mjs` failed twice with `Missing expected rejection.` before any source change. The minimal fixture calls the shipped `issueKey` with anon plus `data:write` and asserts `400 SCOPE_EXCEEDS_KEY_TYPE`, no returned key and no database query. The confirmed cause is that requested scopes replaced the type default without subset validation. The malformed-scope slice also failed with `Missing expected rejection.`; the legacy-rotation slice failed because it performed one UPDATE before rejecting.

No test timeout wrappers are used. The Node runner needs `--experimental-test-isolation=none` in this sandbox to avoid its subprocess restriction. Socket-based tests cannot listen on localhost (`EPERM`); the new HTTP tests replace only the network boundary and do not require a listener. No keys or identity values are printed, and the recording pools do not retain plaintext keys or hashes.

PASS: `node --test --experimental-test-isolation=none tests/unit/api-keys-scope-ceiling.test.mjs tests/blackbox/executor-apikey-scope-ceiling.test.mjs` — all 11 tests pass, covering rejected writes/DDL/mixed scopes, defaults, explicit read scopes, every service subset, malformed and unknown scopes, compliant and legacy rotations, HTTP status/persistence and MCP error propagation.

PASS: negative control with the pristine base API-key module loaded from `/tmp`: the HTTP regression failed with `201 !== 400`, and the MCP regression failed because issuance succeeded instead of returning a 400 error. Default behavior stayed green. Temporary copies were deleted after verification; the assigned branch was never reset or moved.

PASS: `node --check` for the changed source and both new test files, plus `git diff --check`. ADR-1/2/3/5 were reviewed; ADR-5's blanket RLS wording was corrected alongside the two requested documentation pages.

SKIPPED (attempted; rerun unchanged in PR CI): `node --test --experimental-test-isolation=none tests/blackbox/executor-rbac-scope-role-enforcement.test.mjs`, `tests/blackbox/executor-apikey-cross-tenant-idor.test.mjs` and `tests/blackbox/executor-credential-workspace-binding.test.mjs` cannot load the existing `pg` dependency. `tests/unit/control-plane-apikey-identity.test.mjs` cannot listen on localhost (`EPERM`). No dependency manifest or lockfile change is needed.

SKIPPED: Markdown lint requires the absent `markdownlint-cli2` tool; real PostgreSQL/environment checks require integration infrastructure. Run these in PR CI / the release gate. No deployment repository or Hermes-managed workflow pins were changed.
