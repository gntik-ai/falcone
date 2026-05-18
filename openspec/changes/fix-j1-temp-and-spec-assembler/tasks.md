## 1. Failing tests

- [ ] 1.1 [test] Add a case to
      `services/openapi-sdk-service/tests/integration/sdk-builder.test.mjs`
      that runs `buildSdk` end-to-end, captures the `tempRoot` path, and
      asserts the directory does not exist after the call returns,
      proving B3 at `sdk-builder.mjs:51,71`.
- [ ] 1.2 [test] Add a case to
      `services/openapi-sdk-service/tests/unit/spec-assembler.test.mjs`
      that calls `assembleSpec` with a stubbed capability module lacking
      `tag` and asserts the call throws `SpecAssemblyError('TAG_MISSING')`,
      proving B5 at `spec-assembler.mjs:67`.
- [ ] 1.3 [test] Add a case that runs `computeNextVersion` with the same
      tag set but a differing content hash and asserts the result is a
      MINOR bump, proving B6 at `spec-assembler.mjs:39-47`.

## 2. Implementation

- [ ] 2.1 [fix] Replace `await rm(specPath)` in `sdk-builder.mjs:71` with
      `await rm(tempRoot, { recursive: true, force: true })`; ensure the
      cleanup runs on both success and failure paths of the surrounding
      `try/finally`.
- [ ] 2.2 [fix] In `spec-assembler.mjs:67`, guard `spec.tags.push(module.tag)`
      with a check that `module.tag` is a non-null object with a `name`;
      throw `SpecAssemblyError('TAG_MISSING', { capabilityId })` otherwise.
- [ ] 2.3 [fix] Change `computeNextVersion(prev, prevTags, newTags)` to
      `computeNextVersion(prev, prevTags, newTags, prevHash, newHash)`;
      when the tag set is unchanged but `prevHash !== newHash`, return a
      MINOR bump rather than PATCH.
- [ ] 2.4 [impl] At module load (`spec-assembler.mjs:8` cache warm),
      validate every capability module file: each MUST contain `tag.name`,
      `paths`, and `components.schemas`. Throw on first violation naming
      the file.
- [ ] 2.5 [impl] Update the regenerate caller
      (`openapi-spec-regenerate.mjs:21`) to pass the prior `contentHash`
      into `assembleSpec` so `computeNextVersion` can use it.

## 3. Validation

- [ ] 3.1 [docs] Document the new bump rules, the `SpecAssemblyError`
      codes, and the cleanup guarantee in
      `services/openapi-sdk-service/README.md`.
- [ ] 3.2 [test] Re-run
      `corepack pnpm --filter openapi-sdk-service test`; green before merge.
