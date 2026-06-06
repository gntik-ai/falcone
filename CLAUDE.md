# CLAUDE.md

Operating rules for Claude Code in this repository. This is an **open-source code audit** workspace: understanding is derived from **source code only**.

## Domain context (operator-provided base knowledge)
The system under audit is **Falcone, a multitenant BaaS (Backend-as-a-Service)**. This is operator-provided context (not from the repo docs we ignore) — a lens for interpretation and prioritization, never a substitute for code evidence (`path::symbol`).

Audit priorities for a multitenant BaaS, in order:
1. **Tenant isolation (top risk):** every data read/write must be scoped by tenant. Hunt for code paths missing the `tenant_id` (or equivalent) filter — queries, caches, queues, files, logs, events. Cross-tenant leakage / IDOR is the cardinal bug.
2. **Tenant context propagation:** how the tenant is resolved (token/key/host → identity → data scoping) and whether it flows consistently through middleware, services, the data layer, and background jobs.
3. **AuthN/AuthZ per tenant:** API keys/JWT, roles/permissions, privilege escalation, row-level security / per-resource access rules.
4. **Per-tenant quotas, limits, rate limiting** (noisy-neighbor) and resource isolation.
5. **Tenant lifecycle:** provisioning/onboarding, per-tenant config, deletion with cascading cleanup (no orphaned cross-tenant data).
6. **Migrations & schema** per the isolation strategy found in code (shared DB with `tenant_id` / schema-per-tenant / DB-per-tenant).
7. **Per-tenant audit/observability.**

Typical BaaS surface (use to guide capability/functionality extraction, always confirmed in code): CRUD/data API, auth & user management, storage/files, realtime/subscriptions, functions/serverless, access rules/policies, tenant admin/management API.

## Golden rule — code only
- Reason from **source code**, build/config files (for structure & entry points), schemas, and the observable **public surface** (CLI / API / HTTP / public symbols).
- **Never** read, cite, summarize, or rely on repository **documentation**: `README*`, `docs/`, wikis, `CHANGELOG`, `CONTRIBUTING`, narrative `*.md`/`*.rst`/`*.adoc`, or comments that only document intent.
- If a fact is only justifiable via documentation, mark it `⚠ not code-verifiable` instead of asserting it.
- This file (`CLAUDE.md`), everything under `.claude/`, and the generated `audit/` directory are **tooling / auditor output**, not the target project's documentation — exempt from the rule above (downstream commands may read `audit/`) and never deleted by cleanup.

## Vocabulary (reuse IDs for traceability)
- **Capability** (`cap-…`): high-level ability the system offers.
- **Functionality** (`fn-…`): a concrete, testable behavior within a capability.
- **Use case** (`uc-…`): end-to-end flow from an actor's perspective.
- **Black box** (`bbx-…`): tested only through the public interface; no internal knowledge.

Chain: `fn → uc → bbx → OpenSpec scenario → issue`.

## Testing — black box (two suites)
- **Contract suite** (`tests/blackbox/`): drives the public interface only (CLI/API/public symbols). Entrypoint **`bash tests/blackbox/run.sh`** — always run it before declaring work done.
- **Real-stack E2E** (`tests/e2e/`, Playwright): installs + boots the REAL backend and frontend via `tests/e2e/stack.sh up|down|status` and exercises use cases through the actual UI/API. Entrypoint **`bash tests/e2e/run.sh`**. Per-issue verification: `/e2e-issue <change-id>` (spec kept at `tests/e2e/specs/issues/` as regression). Full suite: `/build-e2e` generates specs from the use cases (every `fn-…` covered); `/run-e2e` executes it after the issues are done.
- Both suites: public interface / real UI only; deterministic, isolated, idempotent; fixtures under `tests/*/fixtures/`. E2E fixtures provision two tenants (A/B) and tenancy-sensitive specs include cross-tenant probes.

## Changes — OpenSpec (spec-driven; native tooling)
This repo is initialized with **OpenSpec** (`openspec init --tools claude`). Every bug fix or new feature is an OpenSpec **change**, managed with the native `/opsx:*` workflow and the `openspec` CLI — **do NOT hand-write the change files**.

Lifecycle: **propose → apply → verify → archive**
- **Create**: `/opsx:propose <change-id>` (kebab; `fix-…` for bugs, `add-…` for features) scaffolds `openspec/changes/<change-id>/` (`proposal.md`, `specs/<capability>/spec.md` delta, `design.md`, `tasks.md`).
- **Validate**: `openspec validate <change-id> --strict`.
- **Implement**: `/opsx:apply <change-id>` works through `tasks.md`.
- **Verify**: `/opsx:verify <change-id>` (expanded profile — enable once with `openspec config profile` → add `verify` → `openspec update`).
- **Archive**: `/opsx:archive <change-id>` (syncs the delta into `openspec/specs/`, moves the change to `openspec/changes/archive/`).
- **Inspect**: `openspec list`, `openspec show <change-id>`, `openspec list --specs`.

Spec deltas use EARS (`The system SHALL …`) with `## ADDED/MODIFIED/REMOVED Requirements` and `#### Scenario:` (**WHEN/THEN**).
Work **test-first**: a failing black-box test reproduces a bug (or covers a scenario) before `/opsx:apply`. Never edit tests to pass artificially. The repo wrappers `/fix-bug` and `/implement-change` add this black-box discipline around the OpenSpec lifecycle; `/triage` wraps `/opsx:propose`.

## Analysis pipeline (run from the CLI)
All discovery runs from Claude Code as commands and writes artifacts under `audit/`:
1. `/recon` → `audit/recon.md`
2. `/capabilities` → `audit/capabilities.md`, `audit/functionalities.md`
3. `/use-cases` → `audit/use-cases.md`
4. `/coverage` → `audit/coverage.md`
5. `/audit-isolation` + `/find-bugs` → `audit/bugs.md`
6. `/propose-features` → `audit/proposed-features.md`

`/audit-all` runs 1–6 in order. Then **`/file-issues`** turns bugs and advanced features into OpenSpec changes and **GitHub issues with labels** — dry-run by default; `--confirm` creates them (needs `gh` authenticated).

## Commands (`/`)
- **Analyze** (write to `audit/`): `/recon`, `/capabilities`, `/use-cases`, `/coverage`, `/find-bugs`, `/propose-features`, `/audit-all` (runs them all), `/audit-isolation [scope]` (cross-tenant leakage, read-only).
- **Publish**: `/file-issues [--confirm]` — bugs + advanced features → OpenSpec changes + GitHub issues with labels (`bug`/`enhancement`, `P0|P1|P2`, `cap:<name>`, `security`/`tenant-isolation`, `openspec`). Dry-run by default; needs `gh`.
- **Resolve**: `/triage <description>`, `/fix-bug <change-id>`, `/implement-change <change-id>`, `/run-blackbox [filter]`.
- **Real-stack E2E**: `/e2e-issue <change-id> [--keep-up]` (per-issue, boots real backend + frontend), `/build-e2e` (generate the Playwright suite from use cases), `/run-e2e [filter]` (full suite after issues are done).
- **Maintain**: `/clean-slate [--confirm]` — remove the target repo's docs + reset OpenSpec **content** (preserves the OpenSpec install: `openspec/project.md` + config). Dry-run by default, reversible via git.

## Agents
- **Analysis**: `code-cartographer` (map, read-only), `capability-extractor`, `use-case-writer`, `coverage-analyst`, `feature-proposer`, `bug-hunter`, `tenant-isolation-auditor` (cross-tenant, read-only).
- **Build/verify**: `openspec-author`, `blackbox-test-author`, `e2e-test-author` (Playwright + stack bootstrap), `bug-fixer`, `feature-builder`, `e2e-runner` (runs both suites, read-only).
- **Maintain/publish**: `repo-janitor` (safe cleanup), `issue-reporter` (OpenSpec + GitHub issues).

## Conventions
- Repo-facing artifacts (specs, issues, tests, agents, commands, comments) in **English**.
- Least privilege: read-only agents have no write access.
- Destructive operations (`/clean-slate`, `repo-janitor`) are dry-run by default and never touch source, `tests/`, `audit/`, the OpenSpec install (`openspec/project.md` + config), `.git/`, `.github/`, `.claude/`, `CLAUDE.md`, `LICENSE`, or build/dependency manifests.
