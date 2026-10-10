# Tasks

- [x] Verify the clean assigned worktree, branch, and immutable source base.
- [x] Reproduce route mismatch through storageGet and the real exported routes table before changing source.
- [x] Implement each source behavior after observing its regression test fail: canonical route, binary envelope, malformed JSON, missing/non-string contentBase64, and schema-valid contentType default.
- [x] Preserve output schema, payload limit, credentials, and HTTP status classifications.
- [x] Add handler-to-activity binary round-trip and cross-tenant denial coverage.
- [x] Add this proposal and spec delta and run bounded source checks.
- [ ] PR CI: run the complete scoped suites with installed Temporal, cel-js, and Ajv dependencies.
- [ ] Integration after #997: execute storage.put then storage.get with binary data and verify bytes and content type; repeat with two tenants and record artifact IDs and SHA256 hashes.

## Source identity and seams

Assigned source base: `5f138fcada449d1d613e992a752ba1f232338d57`. Branch: `agent/falcone/1002/bb487d48-83ee-5f07-beb0-992c89740073`. Worktree: `/srv/engineering/worktrees/falcone/bb487d48-83ee-5f07-beb0-992c89740073`. These match the supplied source snapshot and lease identity; the initial worktree was clean.

The public seams are storageGet's injected HTTP request/response boundary, the exported control-plane routes table, and STORAGE_HANDLERS.storageGetObject with PostgreSQL and S3 boundary fixtures. These catch route drift, envelope corruption, classifications, bounds, and tenant denial; they do not prove live gateway, Temporal, or S3 behavior.

## Red-to-green evidence

Repository dependencies are absent and network access is unavailable. A temporary loader at `/tmp/falcone-1002-debug/temporal-loader.mjs` supplies only the external Temporal ApplicationFailure boundary. It does not replace Falcone modules and is not committed. Node test subprocess isolation could not complete with the loader, so checks use `--experimental-test-isolation=none`, without a timeout wrapper.

Reproduction command, run twice before source changes: `node --no-warnings --experimental-loader=/tmp/falcone-1002-debug/temporal-loader.mjs --test --experimental-test-isolation=none tests/contracts/flows-storage-get.contract.test.mjs`. Both runs failed because zero registered GET routes matched the activity URL. Removing only `/download` made it pass, confirming route drift rather than method or parameter encoding as the cause.

The next vertical slice, using `--test-name-pattern='storage.get: canonical'` against `tests/unit/flows-activity-catalog.test.mjs`, failed with base64 of the JSON envelope and `application/json` instead of fixture bytes `AP+AAQ==` and `image/png`. Passing through the parsed envelope fixed it. Subsequent focused tests first failed for unclassified JSON parsing errors, missing contentBase64 being accepted, and a numeric contentType escaping the output schema; each passed after its bounded correction.

## Bounded verification

- PASS: 75 checks with the temporary Temporal boundary double: `node --no-warnings --experimental-loader=/tmp/falcone-1002-debug/temporal-loader.mjs --test --experimental-test-isolation=none tests/unit/flows-activity-*.test.mjs tests/blackbox/flows-activities.test.mjs tests/blackbox/storage-object-io-completeness.test.mjs`.
- PASS: the route contract under the same loader. The broader scoped offline run executed 165 passing checks; its remaining three checks could not load cel-js or Ajv.
- PASS: 89 checks with no SDK double: `node --test --experimental-test-isolation=none tests/blackbox/storage-bucket-*.test.mjs tests/blackbox/storage-handlers-object-key-validation.test.mjs tests/blackbox/storage-object-{binary-put,io-routes,not-found-clean-error,write-envelope}.test.mjs tests/blackbox/storage-per-bucket-credential-scope.test.mjs tests/blackbox/storage-quota-*.test.mjs`.
- PASS: Python jsonschema Draft7Validator validated three real storageGet outputs (PNG, octet stream, and default content type), generated under the temporary Temporal loader. The output schema is byte-identical to the assigned base.
- PASS: syntax checks for all four changed JavaScript modules, whitespace checks, and review of the scoped diff. No debug instrumentation is present in the changed source or tests.
- SKIPPED: the unmodified scoped command `node --test --experimental-test-isolation=none tests/unit/flows-activity-*.test.mjs tests/blackbox/flows-activities.test.mjs tests/blackbox/storage-*.test.mjs tests/contracts/flows-storage-get.contract.test.mjs` could not complete: ERR_MODULE_NOT_FOUND for existing @temporalio/activity and cel-js dependencies. Its dependency-free checks passed; there were no assertion failures.
- SKIPPED: the committed Ajv schema contract cannot run locally because the existing ajv dependency is absent. CI must run it with the real SDK. No dependency or lockfile changes are needed.
- SKIPPED: shared-staging Flow execution and the live two-tenant probe require integration access after #997; this source maker has no network or deployment permission.

One local source commit is the handoff. No push, merge, deployment, credential retrieval, cluster mutation, or deployment-repository write is authorized.
