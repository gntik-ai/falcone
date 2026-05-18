## Context

`services/internal-contracts/` is the only canonical state store for all
cross-service shapes in the monorepo (55 JSON files, 1 767-LOC entry module,
50 production importers). It declares the npm package name
`@in-falcone/internal-contracts` (`package.json:2`) yet zero importers use the
alias. Its `lint`/`test`/`typecheck` scripts are `console.log` placeholders.
The audit's three structural defects (B3, G1, G2) together mean the registry
is undefended at the build layer and unmovable at the source layer.

This is a `complete-*` change because the alias infrastructure literally does
not exist — there is no buggy code path to repair, only missing wiring.

## Goals

- The `@in-falcone/internal-contracts` alias MUST resolve from any workspace
  package; importers MUST stop using relative paths.
- The registry package MUST run `lint`, `test`, `typecheck` as part of every
  CI run with real implementations.
- The 22 versioned registry JSONs MUST have a self-test that asserts each
  `XXX_VERSION` constant is well-formed (covers the implicit invariant in
  `index.mjs:236-255` that today only fails at import time).

## Non-goals

- Splitting versioned registries from schema payloads into separate
  directories (handled by `harden-o2-version-and-shape-drift`).
- Reconciling registry version drift across `2026-03-24` / `2026-03-25` /
  `2026-03-26` / `2026-03-28` (also handled by `harden-o2-version-and-shape-drift`).
- Adding integration tests that exercise the registry through a downstream
  consumer (out of scope; this change is package-local).

## Decisions

### Decision 1: pnpm workspace registration

Add `services/internal-contracts` to `pnpm-workspace.yaml`. Confirm via
`pnpm why @in-falcone/internal-contracts` from any downstream package that
the alias resolves. No changes to the package's existing `exports` map are
required because the package already exports the entry module from `./src`.

### Decision 2: Codemod for the 50 importers

The audit catalogues four distinct relative-path depth conventions plus
direct JSON paths. The codemod is a single regex sweep:

- `'.../services/internal-contracts/src/index.mjs'` → `'@in-falcone/internal-contracts'`
- `'.../services/internal-contracts/src/<name>.json'` →
  `'@in-falcone/internal-contracts/json/<name>'`

The package's `exports` map adds a `./json/*` subpath export pointing at
`./src/*.json` (Node ≥ 22.12 supports JSON subpath exports with
`with { type: 'json' }`). Direct JSON imports preserve their `with { type:
'json' }` attribute.

### Decision 3: Real lint/test/typecheck scripts

- `lint`: `eslint src/ test/ --max-warnings 0` (use the repo's existing eslint
  config inherited from the root).
- `test`: `node --test test/` (Node's built-in runner; no Jest dependency).
- `typecheck`: `tsc --noEmit --allowJs --checkJs --moduleResolution NodeNext
  --target ES2023 src/**/*.mjs` (the `.mjs` files have no types but `--checkJs`
  catches obvious shape mistakes).

### Decision 4: Self-test surface

The new `test/` tree adds:

- `registry-shape.test.mjs` — for each accessor in `src/index.mjs`, call it
  on a no-arg or known-good arg and assert the returned shape's required
  fields are present.
- `version-constants.test.mjs` — assert every `XXX_VERSION` exported constant
  matches the `^\d{4}-\d{2}-\d{2}$` (or `^\d+\.\d+\.\d+$`) pattern at import
  time, surfacing G3's implicit "all 22 registries assumed to have .version"
  invariant.
- `alias-resolution.test.mjs` — confirm the package resolves via its declared
  name.

## Migration plan

1. Land the `pnpm-workspace.yaml` change and the new `exports` map; verify
   `pnpm install` and `pnpm why` work.
2. Run the codemod across all 50 importers in one PR; CI runs every
   downstream package's tests to confirm runtime behaviour is unchanged.
3. Land the real `lint`/`test`/`typecheck` scripts and the `test/` tree;
   CI gates on green.
4. Add a repo-level lint rule prohibiting any future
   `services/internal-contracts/src` relative-path import.

## Risks / Trade-offs

- The codemod sweep touches 50 files; a regex miss leaves a relative-path
  importer. Mitigation: a CI smoke (task 1.3) greps for the prohibited path
  shape and fails the build.
- `--checkJs` on `.mjs` files may surface latent shape mistakes that today
  pass because no type system was applied. Treat these as bugs to fix, not
  as reasons to weaken `typecheck`.
