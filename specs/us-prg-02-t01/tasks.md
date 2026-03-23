# Tasks: PostgreSQL Tenant Isolation ADR Package

**Input**: Design documents from `/specs/us-prg-02-t01/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `quickstart.md`

## Phase 1: Specification and planning

- [x] T001 Create `specs/us-prg-02-t01/spec.md` from the T01 specify prompt.
- [x] T002 Create `specs/us-prg-02-t01/plan.md` from the T01 plan prompt.
- [x] T003 Produce supporting decision artifacts in `specs/us-prg-02-t01/research.md`, `data-model.md`, and `quickstart.md`.

## Phase 2: Decision package

- [x] T004 Author `docs/adr/0002-postgresql-tenant-isolation.md` with compared options, recommendation, consequences, and rollback path.
- [x] T005 Add `docs/reference/postgresql/tenant-isolation-baseline.sql` with baseline roles, grants, and RLS patterns for future implementation tasks.
- [x] T006 Add `tests/e2e/postgresql-tenant-isolation/README.md` with tenant-isolation verification scenarios.
- [x] T007 Add `docs/tasks/us-prg-02-t01.md` to summarize the task breakdown and delivered scope.

## Phase 3: Auditability and validation

- [x] T008 Add `scripts/validate-postgresql-tenant-isolation.mjs` to verify the presence and completeness of the ADR package.
- [x] T009 Wire the new validator into root `package.json` scripts.
- [x] T010 Run repository validation commands and record the outcomes.

## Execution Notes

- Keep scope limited to PostgreSQL isolation governance only.
- Preserve room for sibling tasks US-PRG-02-T02 through US-PRG-02-T06.
- Prefer repository-native documentation and validation over premature runtime implementation.
