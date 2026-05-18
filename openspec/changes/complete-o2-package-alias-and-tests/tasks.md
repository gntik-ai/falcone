## 1. Failing tests

- [ ] 1.1 [test] Add `services/internal-contracts/test/alias-resolution.test.mjs`
      attempting `await import('@in-falcone/internal-contracts')`; assert the
      import resolves and re-exports the expected named symbols (`listServices`,
      `getCommercialPlan`, etc.).
- [ ] 1.2 [test] Add
      `services/internal-contracts/test/version-constants.test.mjs` asserting
      every `XXX_VERSION` exported constant is a non-empty string matching
      `^\\d{4}-\\d{2}-\\d{2}$` (covers G2's missing invariant for the 22
      registries).
- [ ] 1.3 [test] Add a CI smoke that runs `grep -rn "services/internal-contracts/src"
      apps/ services/` and asserts zero matches outside the package itself.

## 2. Implementation

- [ ] 2.1 [impl] Register `services/internal-contracts` in
      `pnpm-workspace.yaml`; verify `pnpm install` links the alias.
- [ ] 2.2 [migration] Run a codemod replacing every relative import path
      ending in `services/internal-contracts/src/...` with the
      `@in-falcone/internal-contracts` alias (or
      `@in-falcone/internal-contracts/json/<filename>` for direct JSON imports)
      across all 50 importers.
- [ ] 2.3 [impl] Replace `package.json:7-11` placeholder scripts with real
      commands (`eslint src/ test/`, `node --test test/`, `tsc --noEmit`); add
      `devDependencies` for eslint and typescript at the workspace root.
- [ ] 2.4 [impl] Add `test/registry-shape.test.mjs` asserting every registry
      JSON parses, every `XXX_VERSION` is computable, and every accessor in
      `src/index.mjs` returns the expected shape on a smoke-fixture call.

## 3. Validation

- [ ] 3.1 [docs] Document the alias contract and the `pnpm --filter
      @in-falcone/internal-contracts test` invocation in
      `services/internal-contracts/README.md`.
- [ ] 3.2 [test] Run `pnpm --filter @in-falcone/internal-contracts test`,
      `pnpm --filter @in-falcone/internal-contracts lint`, `pnpm --filter
      @in-falcone/internal-contracts typecheck`, plus `openspec validate
      complete-o2-package-alias-and-tests --strict`; all green.
