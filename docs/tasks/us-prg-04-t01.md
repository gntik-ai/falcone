# US-PRG-04-T01 Task Breakdown

## Specify summary

Define an incremental testing pyramid and reference package for unit, adapter integration, API contract, console E2E, and resilience testing. Focus on what/why, shared fixtures, and extension-ready scaffolding.

## Executable plan

1. Capture the spec and implementation plan under `specs/us-prg-04-t01/`.
2. Add a repository-native testing strategy artifact with the pyramid, matrix, taxonomy, console states, and API expectations.
3. Add a reusable synthetic reference dataset that later tasks can extend.
4. Add a lightweight validator and one runnable scaffold test per test layer.
5. Update documentation and run root validation commands.

## Concrete implementation tasks

- [x] Add `specs/us-prg-04-t01/spec.md`, `plan.md`, `research.md`, `quickstart.md`, and `tasks.md`.
- [x] Add `tests/reference/testing-strategy.yaml` and `tests/reference/reference-dataset.json`.
- [x] Add `scripts/lib/testing-strategy.mjs` and `scripts/validate-testing-strategy.mjs`.
- [x] Add scaffold tests in `tests/unit/`, `tests/adapters/`, `tests/contracts/`, `tests/e2e/console/`, and `tests/resilience/`.
- [x] Update root scripts, structure validation, and repository readmes.
- [x] Run repository validation commands.
