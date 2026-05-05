# OpenSpec — agent rules for In Falcone

This file is the entry point for any AI coding agent (Claude Code,
Codex CLI, Cursor, etc.) operating on this repository under OpenSpec
governance.

## Reading order at the start of every task

1. `openspec/project.md` — project context.
2. `openspec/conventions.md` — how OpenSpec is applied here.
3. The capability spec(s) under `openspec/specs/` relevant to your task.
4. The change proposal under `openspec/changes/` you are working on (if any).
5. The actual code under `apps/`, `services/`, `charts/`. Always read
   the code; never trust the spec alone.

## Source of Truth precedence

- If a capability spec contradicts the code, the **code wins** until
  you raise a change proposal that updates the spec.
- If a change proposal contradicts a capability spec, the
  **proposal wins** for the duration of its lifecycle; archival is
  what updates the capability spec.
- ADRs in `docs/adr/` are immutable history; they do not change with
  later capability specs.

## When to create a change proposal

Create a new entry under `openspec/changes/` when:

- you are adding a new capability surface (entity, API family, page);
- you are changing the contract of an existing capability (new required
  field, error code, scope);
- you are introducing a new dependency (DB, queue, external service).

Do NOT create a change proposal for:

- bug fixes that bring code back in line with an already-correct spec;
- non-functional refactors;
- test additions that don't change observable behavior.

## Change proposal layout

Each `openspec/changes/<slug>/` directory MUST contain:

- `proposal.md` — Why, scope, non-goals, exit criteria, risks, rollback.
- `tasks.md` — Numbered tasks (`T01`, `T02`, ...) with acceptance and
  test target.
- `design.md` — Internal design choices that don't belong in the spec.

Optionally:

- `migration.md` — DB or contract migration plan.
- `risks.md` — Detailed risk analysis if `proposal.md` doesn't suffice.

## Working style with the split-tool workflow

This repository is operated with a Claude Code (specify/plan) + Codex
CLI (implement) split. Artefacts under `openspec/changes/<change>/tasks.md`
are written so they can be handed to Codex without further translation.

When in **Claude Code**:

1. Read the capability spec.
2. Read the change proposal.
3. Either refine the proposal or hand `tasks.md` to Codex.

When in **Codex CLI**:

1. Read the change proposal `tasks.md` only.
2. Implement task by task, committing after each one.
3. Run `corepack pnpm test:unit` after each task; do not advance until green.
4. Update `tasks.md` with the actual paths of the files you modified,
   so the human reviewer can see drift between plan and reality.

## Things you must never do

- **Never rewrite a file from scratch.** Always use `str_replace`-style
  surgical edits unless the file is brand new.
- **Never delete `docs/tasks/us-*.md`.** They are historical and
  referenced from capability specs' `Trace.` lines.
- **Never modify `services/internal-contracts/` without a change proposal.**
- **Never bypass `services/audit`.** Every state-mutating action emits
  an audit event.
- **Never add a third-party dependency without listing it in the change
  proposal `risks.md`.**

## Validators that MUST remain green before any commit

```bash
corepack pnpm validate:repo
corepack pnpm lint:md
corepack pnpm lint:snippets
corepack pnpm test:unit
```

## Context-window discipline (for LLM agents)

If you are an LLM with a finite context window:

- Skip `pnpm-lock.yaml`, `node_modules/`, `dist/`.
- Read only the OpenAPI families relevant to your capability.
- Use `grep`/`rg` to find call sites — don't read whole services.
- Summarise long files (>500 lines) before opening them in full.

## Output language

All `openspec/` artefacts, all `docs/` documents you produce, all
commit messages, and all PR descriptions are written in **English**.
The human conversation may be in another language; the artefacts are
English.
