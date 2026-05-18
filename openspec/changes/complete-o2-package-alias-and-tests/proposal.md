## Why

`services/internal-contracts/` declares itself as
`@in-falcone/internal-contracts` and ships a `package.json` whose `lint`,
`test`, and `typecheck` scripts are all `console.log` placeholders. The
package alias is unenforced and the registry that 50 importers depend on has
no self-tests. From `openspec/audit/cap-o2-internal-contracts.md`:

- **B3** (`services/internal-contracts/package.json:2`) — the package name
  `@in-falcone/internal-contracts` is declared but `grep "from
  '@in-falcone/internal-contracts'"` returns zero hits across the repo.
- **G1** — all 50 production importers use relative paths at four distinct
  depth conventions (`../../internal-contracts/src/index.mjs`,
  `../../../services/internal-contracts/src/index.mjs`,
  `../../../../services/internal-contracts/src/index.mjs`, and direct JSON
  paths). Renaming the alias is a no-op; moving the directory breaks
  everything.
- **G2** (`services/internal-contracts/package.json:7-11`) — `lint`, `test`,
  `typecheck` are all `node -e "console.log('… placeholder')"`. The contract
  registry has zero self-tests covering its 1 767-LOC entry module.

## What Changes

- Wire `services/internal-contracts/` as a real pnpm workspace package; add
  it to `pnpm-workspace.yaml`; confirm the alias resolves.
- Migrate all 50 importers from relative paths to the
  `@in-falcone/internal-contracts` alias in one mechanical sweep.
- Replace the placeholder `lint`/`test`/`typecheck` scripts with real
  invocations (`eslint`, `node --test`, `tsc --noEmit`). Add a `test/` tree
  with self-tests covering: every `readXxx().version` constant computes
  without throwing, every registry JSON parses, the public-API surface
  matches the exported names.

## Capabilities

### Modified Capabilities

- `deployment-and-operations`: requirement on the internal-contracts package
  — alias-imported, self-tested, lint-checked, type-checked on every CI run.

## Impact

- **Affected code**: `services/internal-contracts/package.json`;
  `pnpm-workspace.yaml`; 50 importer files across `apps/control-plane/`,
  `services/`, `apps/console/`, `apps/web-console/`.
- **Migration required**: a single codemod sweep replacing
  `'(.*)/services/internal-contracts/src/(index|.+\\.json)'` with
  `'@in-falcone/internal-contracts'` (or
  `'@in-falcone/internal-contracts/json/<filename>'` for direct JSON).
- **Breaking changes**: none for runtime behaviour; importer paths change
  shape.
- See `design.md` for the workspace-setup decision tree and migration plan.
