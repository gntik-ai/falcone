# Tasks

- [x] Add version 1 profile template and closed validation without dependencies.
- [x] Reject unsafe image approvals, env, duration, resource and namespace values.
- [x] Add pure hardened Job builder and fail-closed NetworkPolicy builder.
- [x] Add termination classifier and deterministic audit record projection.
- [x] Document fields, defaults, operator trust and deployment prerequisites.
- [x] Add acceptance-driven unit and documentation contract tests, red before green.
- [x] Run full `pnpm test:unit` and `pnpm test:contracts` and record sandbox limits below.
- [x] Create one local source commit without publication or deployment.

## Source validation handoff

- PASS: the three new suites via `node --test` (12 public-interface and contract
  tests, including validation tables, the egress matrix and termination fixtures).
  Each implementation slice followed a failing test: missing exports initially,
  then unsafe profile acceptance and absent policy rendering. In particular,
  `node --test tests/unit/large-task-worker-profile.test.mjs` failed on accepting
  the missing image before closed validation was implemented.
- PASS: strict OpenSpec validation and Markdown lint.
- SKIPPED: full `pnpm test:contracts` cannot pass in this sandbox because six
  existing suites require files under the missing sibling `../falcone-charts`.
  It completed with 80 suite files passing and six fixture errors.
- SKIPPED: full `pnpm test:unit` encounters `listen EPERM` on loopback sockets,
  `spawnSync git EPERM`, `spawnSync /usr/local/bin/node EPERM`, and missing sibling
  chart fixtures. It completed after 279 seconds with 246 suite files passing
  and 15 environment errors. These are environment limits, not claimed passes.
- Diagnostic confirmation: the existing deployment-topology unit tests pass
  7/7 with a temporary working-directory layout linking the assigned source and
  chart checkouts. No repository files or chart files were changed for this check.
- CI must rerun both full suites with socket/subprocess permissions and the
  expected sibling chart checkout. No dependencies, existing runtime paths,
  builders, charts or deployment workflow pins were changed.
