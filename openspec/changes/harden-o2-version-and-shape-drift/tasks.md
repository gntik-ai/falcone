## 1. Failing tests

- [ ] 1.1 [test] Add
      `services/internal-contracts/test/registry-layout.test.mjs` asserting
      every file under `src/registries/` has a top-level `version` and every
      file under `src/schemas/` does not.
- [ ] 1.2 [test] Add a case asserting `PUBLIC_ROUTE_CATALOG_VERSION` is
      exported and equals `readPublicRouteCatalog().release.header_version`.
- [ ] 1.3 [test] Add a case asserting `REGISTRY_VERSIONS.get('authorization-model.json')`
      returns the same string as `authorizationModelSchema.version` (and the
      same for at least three other registries).

## 2. Implementation

- [ ] 2.1 [migration] Move every versioned JSON in `services/internal-contracts/src/`
      into `src/registries/`; move every schema payload into `src/schemas/`;
      update the `new URL('./*.json', import.meta.url)` resolvers in
      `index.mjs:3-23` accordingly.
- [ ] 2.2 [fix] Add a load-time validator at the top of `index.mjs` that
      walks both directories and throws if any file is in the wrong tree.
- [ ] 2.3 [fix] At `index.mjs:236-255` replace the 22 individual
      `XXX_VERSION` constants with a single `REGISTRY_VERSIONS` Map keyed on
      filename; keep `XXX_VERSION` re-exports computed from the Map for back
      compat.
- [ ] 2.4 [fix] Add `PUBLIC_ROUTE_CATALOG_VERSION` derived from
      `release.header_version` (handles B6).
- [ ] 2.5 [fix] Mark `INTERNAL_CONTRACT_VERSION` as deprecated in JSDoc;
      emit a `process.emitWarning` on first read pointing callers at the
      per-registry Map.

## 3. Validation

- [ ] 3.1 [docs] Document the new directory layout, the `REGISTRY_VERSIONS`
      Map, and the deprecation of `INTERNAL_CONTRACT_VERSION` in
      `services/internal-contracts/README.md`.
- [ ] 3.2 [test] Run the registry self-test suite plus `openspec validate
      harden-o2-version-and-shape-drift --strict`; both green.
