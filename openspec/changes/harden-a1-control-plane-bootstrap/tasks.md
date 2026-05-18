## 1. Failing tests proving the gaps

- [ ] 1.1 [test] Add `apps/control-plane/test/package-scripts.test.mjs` that
      runs `pnpm --filter @falcone/control-plane test` and asserts it executes a
      real test runner, proving G4 from `apps/control-plane/package.json:6-10`.
- [ ] 1.2 [test] Add `apps/control-plane/test/server-bootstrap.test.mjs`
      starting `src/server.mjs` and asserting `/v1/platform/route-catalog`,
      `/healthz`, `/readyz` respond 200, proving G5 from
      `src/README.md:5-13` and `public-route-catalog.json:30`.
- [ ] 1.3 [test] Add a case that imports `tenant-management.mjs` and asserts
      its module graph does not include
      `services/adapters/src/storage-tenant-context.mjs`, proving G7 from
      `tenant-management.mjs:12`.
- [ ] 1.4 [test] Add a case that stubs `services/internal-contracts/` to omit
      one contract id and imports each façade; assert the import succeeds and
      the first accessor call surfaces a structured `MissingContractError`,
      proving G10.

## 2. Implementation

- [ ] 2.1 [fix] Replace the three placeholder scripts in
      `apps/control-plane/package.json:6-10` with real
      `node --test`, `eslint`, and `tsc --noEmit` (or `tsd`) invocations.
- [ ] 2.2 [impl] Add `apps/control-plane/src/server.mjs` mounting
      `/v1/platform/route-catalog`, `/healthz`, `/readyz`; register an `entry`
      script.
- [ ] 2.3 [fix] Remove the
      `services/adapters/src/storage-tenant-context.mjs` import from
      `tenant-management.mjs:12`; relocate the helper to internal-contracts or
      inject it through a constructor parameter.
- [ ] 2.4 [fix] Convert eager top-level filter/getter calls in every façade to
      lazy memoised accessors raising `MissingContractError` on first call.

## 3. Docs and validation

- [ ] 3.1 [docs] Update `apps/control-plane/src/README.md` to document the new
      server entrypoint, lazy-access pattern, and dependency boundary.
- [ ] 3.2 [test] Run targeted tests +
      `openspec validate harden-a1-control-plane-bootstrap --strict`; both green.
