## 1. Real-Stack Tests (tests/env) — test-first, failing before implementation

- [x] 1.1 Add a real-stack test group `tests/env/executor/postgres-extension-preflight.test.mjs`
        (placed alongside the executor real-stack slice, which already runs on the pgvector image)
        that asserts: calling `apply()` with `domainData.extensions: [{ name: '<absent> }]`
        returns `status: 'error'`, the result has `action: 'error'`, the message names the
        extension, and no `CREATE EXTENSION` statement is issued (verified via the instrumented
        query call log AND `pg_extension` absence after the call). NOTE: the tests/env image
        (`pgvector/pgvector:pg16`) ALWAYS ships `vector`, so the real-stack failure path uses a
        genuinely-absent extension (`postgis`); the `vector`-specific message wording
        (names `vector` + references `pgvector/pgvector:pgNN`) is exercised against an
        *unavailable* `vector` by the mocked-query unit tests in section 2 / the reprovision suite,
        which can simulate a non-pgvector image. The real-stack test also asserts the failure
        message is clean (no raw PG error / stack trace).
- [x] 1.2 Add a real-stack test in the same file against the `pgvector/pgvector:pg16` image
        (already used by the executor real-stack slice) that asserts: calling `apply()` with
        `domainData.extensions: [{ name: 'vector' }]` returns `status: 'applied'` and
        `action: 'created'`, and `SELECT extname FROM pg_extension WHERE extname = 'vector'`
        returns one row.
- [x] 1.3 Add a real-stack test asserting the dry-run pre-flight: `apply()` with `dryRun: true`
        and an unavailable extension returns `status: 'error'` with the config error message, and
        no row appears in `pg_extension`.
- [x] 1.4 Wire the new test file into `tests/env/executor/run.sh` (the compose run recipe that
        brings up the pgvector Postgres) so it executes as part of the real-stack test suite.
        Confirmed the tests FAIL before the implementation in step 2.

## 2. Unit Test — pre-flight helper (pure logic)

- [x] 2.1 Added a unit test `services/provisioning-orchestrator/src/appliers/postgres-applier.preflight.test.mjs`
        for the `_checkExtensionAvailable` helper. Test cases: query returns a row → returns
        `true`; query returns empty array → returns `false`; query throws → propagates the error
        (no swallowing). Uses a mock `query` function; no real DB required. ALSO extended
        `services/provisioning-orchestrator/tests/reprovision/postgres-applier.test.mjs` with
        mocked-`pg_available_extensions` cases covering the applier-level pre-flight: available
        `vector` → created; unavailable `vector` → error naming `vector` + `pgvector/pgvector`
        (live + dry-run); unavailable non-vector (`postgis`) → error naming the extension. No
        `CREATE EXTENSION` is issued on any failure path.

## 3. Applier Pre-Flight Implementation

- [x] 3.1 Added `export async function _checkExtensionAvailable(name, query)` to
        `services/provisioning-orchestrator/src/appliers/postgres-applier.mjs`: runs
        `SELECT 1 FROM pg_available_extensions WHERE name = $1` via the injected `query`
        function and returns `true` if any row is returned, `false` otherwise (query errors
        propagate, no swallow). Exported so the pure helper is unit-testable.
- [x] 3.2 In `_processResource`, for `resourceType === 'extensions'`, the existence check
        (`pg_extension`) now branches: if the extension is NOT already installed, it invokes
        `_checkExtensionAvailable` BEFORE any `_createResource`. If unavailable, it returns an
        `action: 'error'` result with an actionable message (built by `_unavailableExtensionMessage`).
        For `name === 'vector'` (case-insensitive) the message includes the name and a reference
        to `pgvector/pgvector:pgNN`; other extensions get generic image guidance. The pre-flight
        runs regardless of `dryRun`. If the extension is already installed, the image clearly
        ships it and the pre-flight is skipped (no behaviour change).
- [x] 3.3 Verified the unit tests from step 2 pass (14/14 across both test files) and the
        real-stack tests from step 1 pass (4/4; full executor runner 48/48).

## 4. Chart Value — replace comment-only NOTE with a real key

- [x] 4.1 In `charts/in-falcone/values.yaml`, replaced the comment-only `NOTE (add-vector-search)`
        block with a real `postgresql.dedicatedTenantImage` key (`repository: pgvector/pgvector`,
        `tag: pg17`, `pullPolicy: IfNotPresent`) plus a documenting comment (operator contract,
        not chart-templated). `postgresql.image` (bitnami/postgresql:17.2.0) is unchanged.
        ALSO updated `charts/in-falcone/values.schema.json`: the `postgresql` property is now an
        `allOf` of the shared `component` definition + an explicit `dedicatedTenantImage`
        sub-property referencing the reusable `#/definitions/image` schema, so the new key is a
        first-class, schema-enforced key (a malformed `dedicatedTenantImage` is rejected, verified
        with ajv) rather than relying on the component's `additionalProperties: true`.
- [x] 4.2 Added a cross-reference comment above the `dpf_01regulateddedicated` profile entry
        in `values.yaml` pointing to `postgresql.dedicatedTenantImage` as the recommended image
        for that profile's dedicated Postgres instances (also names profileClass `dedicated`).
- [x] 4.3 Ran `helm lint charts/in-falcone` (0 chart(s) failed) plus
        `npm run validate:deployment-chart`, `npm run validate:deployment-topology`, and
        `npm run lint` — all green. The schema-valid key was confirmed with an ajv compile of
        values.yaml against values.schema.json.

## 5. Validation

- [x] 5.1 Ran `openspec validate add-pgvector-provisioning-preflight --strict` — clean
        (`Change 'add-pgvector-provisioning-preflight' is valid`).
- [x] 5.2 Ran the real-stack suite via `bash tests/env/executor/run.sh` (the recipe that brings
        up the pgvector Postgres and runs the new preflight tests) — 48/48 pass, including the
        4 new preflight tests. (`tests/env/run.sh` targets the backup-status Keycloak slice, a
        different family; the applier preflight lives in the executor recipe.)
- [x] 5.3 Ran the provisioning-orchestrator applier unit tests — 11/11 in
        `tests/reprovision/postgres-applier.test.mjs` and 3/3 in
        `src/appliers/postgres-applier.preflight.test.mjs`. Repo CI suites also green:
        `npm run test:unit` (553 pass/1 pre-existing skip), `test:adapters` (104), `test:contracts`
        (214/17 pre-existing skips), `bash tests/blackbox/run.sh` (340).
