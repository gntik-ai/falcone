# Contributing to Falcone

## Where changes belong

Product services live in `apps/`, shared code in `packages/`, and the CLI in
`tools/`. Tests, validation scripts and deployment bootstrap configuration live in
`tests/`, `scripts/` and `deploy/`. Product documentation lives in `docs/` and the
published VitePress site in `docs-site/`. Helm charts live in the companion
[`gntik-ai/falcone-charts`](https://github.com/gntik-ai/falcone-charts) repository.

The source repository also preserves engineering memory and process evidence:

| Path | Purpose |
| --- | --- |
| `openspec/` | Tracked change proposals, designs, tasks and specifications; stays at the root for OpenSpec workflows |
| `falcone-loop-state/` | Agent capabilities, coverage, findings, run log and test plans |
| `spikes/` | Experiments and captured evidence referenced by ADRs and regression tests |
| `delivery-adapter/` | Versioned external delivery-workflow snapshot with an integrity manifest |
| `docs/track-f/` | Engineering triage, delivery plans and agent prompts |
| `internal-contracts/secrets/` | Retained schema baselines; these define contracts and contain no operational credentials |

These files preserve the reasoning and evidence behind decisions and support
Hermes deliveries. Keep them traceable; do not delete agent memory or relocate it
as incidental cleanup. `packages/internal-contracts/` is product code and remains
in its current location, as does the top-level `internal-contracts/` baseline.

The [phase-1 inventory](openspec/changes/restructure-repository-agent-material/inventory.md)
classifies all tracked paths. The [separation design](openspec/changes/restructure-repository-agent-material/design.md)
plans a later `.engineering/` grouping for selected process material. That move
requires deployed Hermes support for both layouts and verification of in-flight
deliveries. The current change only documents the layout and removes accidental
IDE settings; all agent/process paths retain their current locations.

## Proposals and evidence

New OpenSpec changes belong under `openspec/changes/<change-name>/`. The repository
currently ignores `/openspec/` for local tooling, even though existing specifications
are tracked. Add a new reviewed change explicitly with
`git add -f openspec/changes/<change-name>/`; verify its files with `git ls-files`.
Discover references with `git grep` so ignored-but-tracked specifications are included.

Keep captured evidence associated with its experiment or change. Preserve historical
records and integrity manifests, and distinguish recorded observations from live
instructions. Do not include credentials, tokens, kubeconfigs or OAuth material in
proposals or evidence. Local `.idea/` settings are ignored and must remain untracked.

## Validation

Use the repository's existing gates before proposing a change:

```sh
pnpm lint
pnpm test:unit
bash tests/blackbox/run.sh
```

Some gates require installed workspace dependencies, a paired charts checkout or
integration services. Report unavailable prerequisites and let the PR CI checks
complete them. Keep the lint, test, integration and documentation-build gates intact.
