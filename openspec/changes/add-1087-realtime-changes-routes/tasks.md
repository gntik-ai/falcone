# Tasks and source handoff

- [x] Verify clean assigned worktree, branch and existing implementation HEAD.
- [x] Review prior commit's publication, bounded gateway exception, dispatcher
  authentication, PostgreSQL pre-stream precheck and regression coverage.
- [x] Preserve existing source implementation and all safety gates.
- [x] Add the required proposal, tasks and spec delta missing from the prior commit.
- [x] Run the dependency-free authorization and publication regressions.
- [ ] PR CI: gateway policy unit and contract suites and public API consistency.
- [ ] PR CI: structural OpenAPI validation and Markdown lint.
- [ ] PR CI: existing socket-based collection/table SSE route tests.
- [ ] Real-stack CI: PostgreSQL catalog denials, no capture DDL, event sequence and
  same-tenant workspace isolation; DocumentDB collection sequence and isolation.
- [ ] Publisher: link and land paired falcone-charts routing/values; Hermes manages
  workflow chart pins. Confirm long upstream timeout and deployed connection caps.
- [ ] Runtime verifier: conditional staging gateway positives, 401/403, OPTIONS and
  rejected methods, mongo-captures matching, #1118 log redaction, endpoints[224] OK.

## Review identity and scope

Source lease: issue #1087, run `92e3a89f-1712-55dc-ac3d-35505a500d70`, branch
`agent/falcone/1087/92e3a89f-1712-55dc-ac3d-35505a500d70`. Starting HEAD is
`31dac207c481060600d367ab4d3cf35a07c72445` on immutable base
`7c6d01dcaed747b154237cd2e2809ba2b38a6752`. The worktree started clean; no local
AGENTS.md, GLOSSARY.md or additional lease file was present. The supplied execution
contract, OpenSpec and R2 policy bound this follow-up. No runtime source, manifests,
lockfiles, chart pins or deployment files are changed by this follow-up.

## Bounded evidence

The authorization suite exercises public requests through the real executor
dispatcher and PostgreSQL executor, substituting only database I/O. All 11
assertions pass with `node --test --experimental-test-isolation=none
tests/unit/realtime-changes-authorization.test.mjs`. This covers JSON 403/404 before
capture DDL, unsupported identifiers, shared fallback rejection, credential
precedence, workspace binding, bearer support, disabled executors, terminal
initialization errors, schema USAGE, SELECT-authorized table frames and query-key
log redaction. The publication suite verifies both catalog/OpenAPI operations and
their independent literal event sets.

The missing OpenSpec folder was confirmed before adding documentation. This
follow-up changes only documentation, so it does not claim a new runtime bug
reproduction or new runtime fix. The prior commit message records its original
red reproduction (HTTP 200 instead of 403 for an API key without SELECT).

Gateway-policy and public API suites cannot load the existing `yaml` dependency
(`ERR_MODULE_NOT_FOUND`). Structural OpenAPI validation requires the missing
`@apidevtools/swagger-parser` package; PostgreSQL and DocumentDB suites require the
missing `pg` and `mongodb` dependencies and their real stores. Socket-based route
tests require a loopback listener unavailable in this sandbox. These remain CI
handoff checks, not passing evidence or assertion failures. No new dependency or
lockfile resolution is required, and no test timeout wrapper is used.

The Node test subprocess runner reports only file-level results here; the direct
runner with `--experimental-test-isolation=none` exposes individual assertions and
is used to verify the available suites. No cluster, network, release credentials,
deployment execution or historical campaign material is accessed.
