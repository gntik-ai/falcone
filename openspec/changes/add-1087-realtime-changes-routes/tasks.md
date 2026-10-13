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

## Quality CI repair

- [x] Verify the same source lease and clean branch at starting HEAD
  `b404701bafb4981957711075e4efb073bb4e233c`.
- [x] Use the supplied quality CI failure as red evidence: testing-strategy
  validation rejects both GET streams for optional `X-API-Version` headers.
- [x] Add the regression at the public testing-strategy validator seam before
  changing its source; local execution cannot import the existing `yaml` package.
- [x] Reuse the existing exact-path, GET-only `realtime-changes` exception in
  testing-strategy validation. Keep the pinned version check and documentation of
  both headers; retain required headers for every other operation.
- [x] Add negative coverage for other paths, methods and families, capture
  management, an incorrect optional version, and missing header declarations.
- [x] Run the existing dependency-free authorization and publication suites:
  all 12 assertions pass with
  `node --test --experimental-test-isolation=none tests/unit/realtime-changes-publication.test.mjs tests/unit/realtime-changes-authorization.test.mjs`.
- [x] Check both changed JavaScript files with `node --check` and check the patch
  with `git diff --check`.
- [ ] PR CI: rerun `pnpm lint`, `pnpm validate:testing-strategy`, and the
  testing-strategy, public API and gateway-policy unit/contract suites.

Confirmed cause: testing-strategy validation did not apply the EventSource header
exception already used by the public API validators. Requiring custom headers
would contradict the approved plain EventSource contract. The local matching
command `pnpm validate:testing-strategy` cannot load `yaml`; `pnpm lint` cannot
start its repository checks because `npm` is absent. The scoped unit/contract
command also cannot import `yaml`. These checks are SKIPPED due to sandbox
dependencies, not assertion failures. No manifests or lockfiles need changing.

The quality job's missing workflow/restore upload artifacts follow the earlier
lint failure: their generating steps were skipped. Preserve all CI jobs, tests,
artifact requirements and Hermes-managed chart pins; the complete CI rerun must
produce and upload those artifacts. Real-store and deployed acceptance remain
the handoff checks above.

## Anchored chart contract repair

- [x] Verify the same assigned branch and clean starting HEAD
  `637106ac1daa5997e765c617929a2889669407ff`.
- [x] Reproduce the checker finding before editing with
  `node --test tests/contracts/gateway-apikey-routes.contract.test.mjs`.
  The direct runner confirms the stale `/changes$` equality assertion fails
  against the paired chart's anchored stream constraint.
- [x] Exercise the actual chart URI regex with both stream paths and negative
  capture-management, malformed, prefixed and suffixed paths. Assert the current
  `product_api` route kind, `realtime-changes` family, GET/OPTIONS, cors, and
  header/query rate-limit keys. Update the contract header's description.
- [x] Rerun the repaired contract, gateway-policy and public-API unit suites,
  testing-strategy unit/contract suites, authorization and publication suites:
  all pass. Gateway-policy and testing-strategy validators also pass.
- [x] Run `pnpm test:unit` and `pnpm test:contracts`; both remain SKIPPED as full
  gates because existing dependencies are unavailable. Detailed contract output
  shows missing packages, including cel-js, swagger-parser, ajv and Temporal.
- [x] Check the changed test with `node --check` and the patch with
  `git diff --check`.

Validation uses a temporary directory of symlinks to this source worktree and the
assigned paired chart, preserving the repository's expected sibling layout.
The only locally available YAML parser is the tooling copy of yaml 2.9.1, linked
under ignored node_modules; PR CI must repeat validation with the locked packages.
No dependency manifests, lockfiles, runtime source, CI gates or chart pins change.

`pnpm lint` is SKIPPED because npm is absent. Public-API and structural OpenAPI
validation need swagger-parser; Markdown lint needs markdownlint-cli2. The real
PostgreSQL and DocumentDB tests cannot import pg and mongodb and require their
stores. These checks, full CI, artifact uploads and live gateway behaviour remain
the publication/runtime handoff. No added timeout wrapper is used.
