# Tasks: US-BKP-02-T02 — Versioned Export/Import Format

**Input**: Design documents from `/specs/116-versioned-export-import-format/`
**Prerequisites**: plan.md ✅, spec.md ✅
**Tests**: Included — spec §12 defines an explicit test strategy per component
**Organization**: Tasks grouped by implementation layer following plan §16 (Secuencia de implementación)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no blocking dependencies)
- **[Story]**: Implementation layer group (US1–US7)
- All paths relative to repo root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create directory structure required before any implementation begins.

- [ ] T001 Create `services/provisioning-orchestrator/src/schemas/` directory with `schemas/migrations/` subdirectory (add `.gitkeep` to `migrations/` so git tracks it)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: JSON Schema contract and in-memory schema registry — all other phases depend on these.

**⚠️ CRITICAL**: No US1–US7 work can begin until this phase is complete.

- [ ] T002 Create JSON Schema draft 2020-12 document `services/provisioning-orchestrator/src/schemas/v1.0.0.schema.json` per plan §4: root object requires `export_timestamp`, `tenant_id`, `format_version` (pattern `^1\\.\\d+\\.\\d+$`), `deployment_profile`, `correlation_id`, `schema_checksum` (pattern `^sha256:[a-f0-9]{64}$`), `domains`; `$defs` for `DomainStatus`, `DomainSection`, `MigrationMetadata`; `additionalProperties: true` at root and domain level (RF-T02-01, RF-T02-07)
- [ ] T003 Create `services/provisioning-orchestrator/src/schemas/schema-registry.mjs`: in-memory registry exporting `getCurrentVersion()` → `'1.0.0'`, `getMinMigratable()` → `'1.0.0'`, `getSupportedVersions()` → version catalog array, `getSchemaFor(version)`, `getChecksum(version)` (sha256 of canonical JSON of imported schema file computed at module init via `node:crypto`), `buildMigrationChain(fromVersion, toVersion)` → ordered migration fn array (empty map in v1), `isSameMajor(vA, vB)` (plan §5)
- [ ] T004 [P] Create `services/provisioning-orchestrator/src/schemas/index.mjs`: re-exports `getSchemaRegistry` and all named exports from `schema-registry.mjs` as the public API of the schemas module (plan §3)
- [ ] T005 [P] Create `services/provisioning-orchestrator/src/tests/schemas/schema-registry.test.mjs`: unit tests for `getCurrentVersion()`, `getChecksum()` (returns `sha256:` prefixed hex, stable across calls), `buildMigrationChain()` returns empty array in v1, `buildMigrationChain()` throws or returns error-signalling value for unknown source version, `isSameMajor('1.0.0', '1.3.0')` → `true`, `isSameMajor('1.0.0', '2.0.0')` → `false` (plan §12.1)
- [ ] T006 [P] Create `services/provisioning-orchestrator/src/tests/schemas/v1.0.0-schema.test.mjs`: validate the JSON Schema itself against known-good T01 artifacts in four scenarios — all-domains-ok, partial-error, not_available domain, artifact with extra unknown fields at root and in DomainSection (plan §12.1, CA-02, CA-10)

**Checkpoint**: `schema-registry.test.mjs` and `v1.0.0-schema.test.mjs` pass — foundational layer ready.

---

## Phase 3: User Story 1 — Export patch: semver + schema_checksum (Priority: P1) 🎯

**Goal**: Existing `tenant-config-export.mjs` emits `format_version: "1.0.0"` (semver) and a `schema_checksum` field in the artifact metadata root, satisfying RF-T02-09 and CA-13.

**Independent Test**: Export an artifact and assert `metadata.format_version === '1.0.0'` and `metadata.schema_checksum` matches `/^sha256:[a-f0-9]{64}$/`.

- [ ] T007 [US1] Modify `services/provisioning-orchestrator/src/actions/tenant-config-export.mjs`: change constant `FORMAT_VERSION` from `'1.0'` to `'1.0.0'`; import `getSchemaRegistry` from `../schemas/index.mjs`; add `schema_checksum: schemaRegistry.getChecksum('1.0.0')` to the artifact object before `JSON.stringify` (plan §6; CA-13)
- [ ] T008 [US1] Create `services/provisioning-orchestrator/src/tests/actions/tenant-config-export-checksum.test.mjs`: assert exported artifact contains `format_version: '1.0.0'` and `schema_checksum` matching `^sha256:[a-f0-9]{64}$`; update any existing assertions in the same file that checked `format_version: '1.0'` (plan §12.1, §12.4; CA-13)

**Checkpoint**: Updated export test passes — artifacts produced by T01 now carry semver and schema_checksum.

---

## Phase 4: User Story 2 — Kafka audit events module (Priority: P1)

**Goal**: Reusable events module that publishes `console.config.schema.validated` and `console.config.schema.migrated` to Kafka — required by validate and migrate actions before they can be wired up.

**Independent Test**: Module exports `publishValidationEvent` and `publishMigrationEvent`; calling them with a mock Kafka producer does not throw and serializes the correct event schema.

- [ ] T009 [US2] Create `services/provisioning-orchestrator/src/events/config-schema-events.mjs`: fire-and-forget Kafka publisher exporting `publishValidationEvent({ correlationId, tenantId, actorId, actorType, formatVersionValidated, result, errorCount, warningCount, schemaChecksumMatch, migrationRequired })` → publishes to `CONFIG_SCHEMA_KAFKA_TOPIC_VALIDATED` (default `console.config.schema.validated`, 30d retention) and `publishMigrationEvent({ correlationId, tenantId, actorId, actorType, migratedFrom, migratedTo, migrationChain, hasMigrationWarnings })` → publishes to `CONFIG_SCHEMA_KAFKA_TOPIC_MIGRATED` (default `console.config.schema.migrated`, 30d retention); reuses Kafka connection pattern from `config-export-events.mjs` (plan §8.2, CA-14, CA-15)
- [ ] T010 [US2] Document new environment variables in `services/provisioning-orchestrator/README.md` (or Helm values comments): `CONFIG_SCHEMA_KAFKA_TOPIC_VALIDATED` (default `console.config.schema.validated`), `CONFIG_SCHEMA_KAFKA_TOPIC_MIGRATED` (default `console.config.schema.migrated`), `CONFIG_SCHEMA_MAX_INPUT_BYTES` (default `10485760`) (plan §8.3)

**Checkpoint**: `config-schema-events.mjs` can be imported by validate and migrate actions.

---

## Phase 5: User Story 3 — Format versions endpoint (Priority: P1)

**Goal**: `GET /v1/admin/config/format-versions` returns current version, min migratable, and full versions catalog — satisfying RF-T02-04, CA-12.

**Independent Test**: Call the action directly with empty params; assert response contains `current_version: '1.0.0'`, `min_migratable_version: '1.0.0'`, and `versions` array with at least one entry with `version`, `release_date`, `change_notes`, `schema_checksum` fields.

- [ ] T011 [US3] Create `services/provisioning-orchestrator/src/actions/tenant-config-format-versions.mjs` OpenWhisk action: authenticate with `platform:admin:config:export` scope (Keycloak JWT, same as T01 pattern); call `getSupportedVersions()` and `getMinMigratable()` from schema registry; return `{ current_version, min_migratable_version, versions: [{ version, release_date, change_notes, schema_checksum }] }`; 403 on auth failure (plan §7.3, CA-12)
- [ ] T012 [P] [US3] Create `services/provisioning-orchestrator/src/tests/actions/tenant-config-format-versions.test.mjs`: assert CA-12 response shape, `current_version === '1.0.0'`, `min_migratable_version` present, `versions` array non-empty with required fields; assert 403 when called without valid auth context (plan §12.1)

**Checkpoint**: Format-versions action returns correct metadata — CA-12 passes.

---

## Phase 6: User Story 4 — Validation endpoint (Priority: P1)

**Goal**: `POST /v1/admin/tenants/{tenant_id}/config/validate` validates an artifact against the schema of its declared `format_version` — satisfying RF-T02-02, RF-T02-07, RF-T02-10, RF-T02-11, CA-02–CA-06, CA-10, CA-14.

**Independent Test**: POST a T01 artifact → `valid`; POST artifact without `format_version` → 400; POST artifact with `format_version: "99.0.0"` → 422; POST artifact with extra fields → `valid_with_warnings`.

- [ ] T013 [US4] Create `services/provisioning-orchestrator/src/actions/tenant-config-validate.mjs` OpenWhisk action: auth check (`platform:admin:config:export`); reject body > `CONFIG_SCHEMA_MAX_INPUT_BYTES` with 413; read `format_version` from body — missing → 400 `format_version is required`; unknown/future version → 422 `format_version X not recognized`; retrieve schema via `getSchemaFor(version)`; validate with Ajv (JSON Schema draft 2020-12) collecting all errors; detect additional properties at root and in each `DomainSection` → `warnings`; compute `schema_checksum_match` by comparing artifact's `schema_checksum` against `getChecksum(version)`; determine `migration_required` (major(version) < major(current)); respond `{ result: 'valid'|'invalid'|'valid_with_warnings', format_version, errors, warnings, schema_checksum_match, migration_required }`; 200 for valid/valid_with_warnings, 422 for invalid structure; call `publishValidationEvent` from config-schema-events.mjs (fire-and-forget); 403 on auth failure (plan §7.1, RF-T02-02, RF-T02-07, RF-T02-10, RF-T02-11)
- [ ] T014 [P] [US4] Create `services/provisioning-orchestrator/src/tests/actions/tenant-config-validate.test.mjs`: CA-02 (valid T01 artifact → `valid`); CA-03 (missing required field → `invalid` with error list); CA-04 (no `format_version` → 400); CA-05 (`format_version: '99.0.0'` → 422); CA-06 (artifact `1.0.0` on platform `1.2.0` same major → `valid`); CA-10 (extra fields → `valid_with_warnings` with warning list, not rejected); assert 403 without auth (plan §12.1)

**Checkpoint**: Validation action passes all CA-02–CA-06 and CA-10 — CA-14 verified by event stub.

---

## Phase 7: User Story 5 — Migration endpoint (Priority: P1)

**Goal**: `POST /v1/admin/tenants/{tenant_id}/config/migrate` executes the migration chain from an older major version to current — satisfying RF-T02-05, RF-T02-06, RF-T02-08, CA-07–CA-09, CA-11, CA-15, CA-16.

**Independent Test**: POST a v1.0.0 artifact to a v1 platform → 200 with `migration_required: false` (no-op); simulate future scenario: artifact already at current major returns unchanged with no `_migration_metadata`; chain-failure test: if a migration fn throws, response is 422 with `failed_at_step`.

- [ ] T015 [US5] Create `services/provisioning-orchestrator/src/actions/tenant-config-migrate.mjs` OpenWhisk action: auth check (`platform:admin:config:export`); reject body > `CONFIG_SCHEMA_MAX_INPUT_BYTES` with 413; read `format_version` — missing → 400; unknown/future version → 422; if same major as current → respond 200 `{ migration_required: false, artifact }` unchanged; call `buildMigrationChain(fromVersion, currentVersion)` — if empty (same major) no-op; execute migration functions sequentially (pure, deterministic, no I/O); on migration step failure → stop chain, respond 422 with `{ error, failed_at_step, steps_completed }`; collect `_migration_warnings` from each migration fn result; validate migrated artifact against current schema — if invalid respond 500 (bug in migration); add `_migration_metadata: { migrated_from, migrated_to, migration_chain, migrated_at }` to migrated artifact; respond 200 with migrated artifact; call `publishMigrationEvent` fire-and-forget; 403 on auth failure (plan §7.2, RF-T02-05, RF-T02-06, RF-T02-08)
- [ ] T016 [P] [US5] Create `services/provisioning-orchestrator/src/tests/actions/tenant-config-migrate.test.mjs`: CA-07 (v1.0.0 artifact on v1.0.0 platform → `migration_required: false`, artifact unchanged); CA-08 (stub two migration fns in chain → both applied in order, result conforms to target schema); CA-09 (second of three fns throws → 422, `failed_at_step: 1`, no partial artifact returned); CA-11 (migration fn returns `_migration_warnings` → included in response); CA-16 (same input twice → identical output, timestamps excluded from equality); assert 403 without auth (plan §12.1)

**Checkpoint**: Migration action passes CA-07–CA-09, CA-11, CA-16 — CA-15 verified by event stub.

---

## Phase 8: User Story 6 — APISIX gateway routes (Priority: P1)

**Goal**: Three new routes in APISIX for validate, migrate, and format-versions — satisfying routing, auth plugin, rate-limit and timeout requirements from plan §9.

**Independent Test**: Routes respond 403 without valid JWT (manual or CI check per plan §17 last row).

- [ ] T017 [US6] Modify `services/gateway-config/routes/backup-admin-routes.yaml`: append three route definitions: `config-validate-post` (`POST /v1/admin/tenants/*/config/validate`, 15s timeout, rate 10/burst 20, `platform:admin:config:export` scope, `Cache-Control: no-store`); `config-migrate-post` (`POST /v1/admin/tenants/*/config/migrate`, 30s timeout, rate 5/burst 10, same scope, `Cache-Control: no-store`); `config-format-versions-get` (`GET /v1/admin/config/format-versions`, 10s timeout, rate 30/burst 60, same scope) (plan §9)

**Checkpoint**: APISIX config valid YAML and passes linting — 3 new routes present.

---

## Phase 9: User Story 7 — Console layer (Priority: P2)

**Goal**: React console panel allowing operators to paste/upload a JSON artifact, see validation results, trigger migration if needed, and download the migrated artifact — satisfying plan §10.

**Independent Test**: Render `<ConfigArtifactValidator />` with a mock API client; paste valid JSON → shows `valid` badge; paste JSON with extra fields → shows `valid_with_warnings` + warning list; `migration_required: true` → shows "Migrate artifact" button.

- [ ] T018 [US7] Create `apps/web-console/src/api/configSchemaApi.ts`: TypeScript types `ValidationResult`, `MigrationResult`, `FormatVersionsResponse`, `FormatVersionEntry`, `AjvError`, `MigrationMetadata`, `MigrationWarning`, `ExportArtifact`; async functions `validateArtifact(tenantId, artifact)`, `migrateArtifact(tenantId, artifact)`, `getFormatVersions()` calling new APISIX endpoints with existing auth header pattern from `configExportApi.ts` (plan §10)
- [ ] T019 [P] [US7] Create `apps/web-console/src/components/ConfigArtifactValidator.tsx`: React component with local state only (no Redux); textarea/file-input for artifact JSON; parse and display detected `format_version`; call `validateArtifact` on submit; render result badge (`valid` / `invalid` / `valid_with_warnings`), error list, warning list, `schema_checksum_match` indicator, `migration_required` flag; conditionally show "Migrate artifact" button when `migration_required: true`; on migration success render migrated artifact JSON with download link and `_migration_warnings` section (plan §10)

**Checkpoint**: Console component renders and handles all three validation states — manual UI smoke test passes.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Final wiring, auth hardening, and documentation alignment.

- [ ] T020 [P] Add 413 body-size guard to `tenant-config-validate.mjs` and `tenant-config-migrate.mjs` using `CONFIG_SCHEMA_MAX_INPUT_BYTES` env var (default `10485760`); verify the guard is exercised by adding one 413 assertion per action test file (plan §7.1, §7.2)
- [ ] T021 [P] Update `AGENTS.md` (in repo root) under `<!-- MANUAL ADDITIONS START -->`: document US-BKP-02-T02 new files (schemas module, 3 new actions, events module, console components), 3 new env vars, 2 new Kafka topics, and the `format_version '1.0.0'` change in export action

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — **BLOCKS all US phases**
- **US1 / Phase 3**: Depends on Phase 2 (needs `schemas/index.mjs`)
- **US2 / Phase 4**: Depends on Phase 2 (Kafka pattern reference only; can run in parallel with US1)
- **US3 / Phase 5**: Depends on Phase 2 — independent of US1, US2
- **US4 / Phase 6**: Depends on Phase 2 + Phase 4 (needs `config-schema-events.mjs`)
- **US5 / Phase 7**: Depends on Phase 2 + Phase 4 (needs `config-schema-events.mjs`)
- **US6 / Phase 8**: Depends on Phase 5, 6, 7 being conceptually complete (routes point to those actions); YAML can be drafted in parallel
- **US7 / Phase 9**: Depends on Phase 2 for types; can be parallelized with Phases 5–7 as noted in plan §16
- **Polish (Phase 10)**: Depends on all phases complete

### User Story Dependencies

```
Phase 1 → Phase 2 → US1 (Phase 3)     — independent
                  → US2 (Phase 4)     — independent, blocks US4, US5
                  → US3 (Phase 5)     — independent
                  → US4 (Phase 6)     — depends on US2
                  → US5 (Phase 7)     — depends on US2
                  → US6 (Phase 8)     — depends on US3+US4+US5 (actions must exist)
                  → US7 (Phase 9)     — can parallel-start with US3–US5
```

### Within Each Phase

- Models/modules before their consumers
- Tests are written alongside or immediately after their implementation target
- `config-schema-events.mjs` (T009) must exist before `tenant-config-validate.mjs` (T013) and `tenant-config-migrate.mjs` (T015) are completed

### Parallel Opportunities

- T005 (migrations `.gitkeep`) can run parallel with T002 and T003
- T006, T007 (schema tests) can run parallel with each other
- Once Phase 4 (events module, T009) is done: T011 (format-versions action), T013 (validate action), T015 (migrate action) can proceed in parallel by different developers
- T018 (configSchemaApi.ts) and T019 (ConfigArtifactValidator.tsx) can be done in parallel once API contracts are known (after Phase 2)
- T020 and T021 (polish) are both [P]

---

## Parallel Example: Phases 5–7 (after Phase 4 is done)

```bash
# Developer A — Phase 5 (format-versions):
Task T011: Create tenant-config-format-versions.mjs
Task T012: Create tenant-config-format-versions.test.mjs

# Developer B — Phase 6 (validation):
Task T013: Create tenant-config-validate.mjs
Task T014: Create tenant-config-validate.test.mjs

# Developer C — Phase 7 (migration) + Phase 9 (console) in parallel:
Task T015: Create tenant-config-migrate.mjs
Task T016: Create tenant-config-migrate.test.mjs
Task T018: Create configSchemaApi.ts   ← can start earlier
Task T019: Create ConfigArtifactValidator.tsx
```

---

## Implementation Strategy

### MVP First (Schema + Validation Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3 (US1): Export patch → artifacts carry semver + checksum
4. Complete Phase 5 (US3): Format versions endpoint
5. Complete Phase 4 (US2): Events module
6. Complete Phase 6 (US4): Validation endpoint
7. **STOP and VALIDATE**: CA-02–CA-06, CA-10, CA-12, CA-13 pass
8. Continue with Phase 7 (US5: Migration), Phase 8 (US6: Routes), Phase 9 (US7: Console)

### Sequential Delivery

1. Phases 1+2 → Foundation ready (T001–T006)
2. Phase 3 → Export emits semver + checksum (T007–T008)
3. Phase 4 → Kafka events module (T009–T010)
4. Phases 5–7 → Three new actions + tests (T011–T016) — can be done in parallel
5. Phase 8 → APISIX routes (T017)
6. Phase 9 → Console components (T018–T019)
7. Phase 10 → Polish + docs (T020–T021)

---

## Task Summary

| Phase | Tasks | Count |
|-------|-------|-------|
| Phase 1: Setup | T001 | 1 |
| Phase 2: Foundational (Schema + Registry) | T002–T006 | 5 |
| Phase 3 [US1]: Export patch | T007–T008 | 2 |
| Phase 4 [US2]: Kafka events module | T009–T010 | 2 |
| Phase 5 [US3]: Format versions endpoint | T011–T012 | 2 |
| Phase 6 [US4]: Validation endpoint | T013–T014 | 2 |
| Phase 7 [US5]: Migration endpoint | T015–T016 | 2 |
| Phase 8 [US6]: APISIX routes | T017 | 1 |
| Phase 9 [US7]: Console layer | T018–T019 | 2 |
| Phase 10: Polish | T020–T021 | 2 |
| **Total** | | **21** |

**Parallel opportunities**: 9 tasks marked [P] across phases 2, 3, 5–7, 9–10
**MVP scope**: Phases 1–2 + Phase 3 + Phases 4–6 (schema, export patch, events, format-versions, validation) — 14 tasks

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks — safe to parallelize
- [Story] label maps task to implementation layer for traceability against plan §16
- Each phase should be independently completable and testable before moving on
- The `schemas/migrations/` directory is intentionally empty in v1 — populated when format evolves
- `config-schema-events.mjs` follows fire-and-forget pattern; validate/migrate actions do not await event publication
- The schema checksum is computed at module init (not per-request) — stable across calls within a process lifecycle
- Ajv must be added as a dependency to `services/provisioning-orchestrator/package.json` if not already present
- Verify tests fail before implementing their corresponding source (TDD discipline per spec §12)
- Commit after each phase or logical group; push to `116-versioned-export-import-format`

---

*Tasks generated for stage `speckit.tasks` — US-BKP-02-T02 | Branch: `116-versioned-export-import-format`*
