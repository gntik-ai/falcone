---
description: Remove the target repo's documentation and reset previously generated OpenSpec CONTENT, preserving the OpenSpec installation. Destructive; dry-run by default.
argument-hint: "[--dry-run | --confirm]   (default: --dry-run)"
allowed-tools: Read, Glob, Grep, Bash
---
Goal: leave the repository clean of (a) human documentation and (b) previously generated OpenSpec content, WITHOUT breaking the OpenSpec installation. Source code, tests, build/config and tooling are NEVER touched.

Mode: read $ARGUMENTS. Run in DRY-RUN unless it contains `--confirm`.

IN SCOPE for deletion:
- OpenSpec CONTENT only: the contents of `openspec/specs/` and `openspec/changes/` (including `openspec/changes/archive/`). Leave the directories themselves in place.
- Documentation files anywhere in the repo:
  - `README*`, `CHANGELOG*`, `CONTRIBUTING*`, `CODE_OF_CONDUCT*`, `SECURITY*`, `SUPPORT*`, `AUTHORS*`, `MAINTAINERS*`, `GOVERNANCE*`
  - directories `docs/`, `doc/`, `documentation/`, `wiki/`
  - narrative docs by extension: `*.md`, `*.mdx`, `*.rst`, `*.adoc`

NEVER delete (PROTECTED — if a match falls here, exclude it and warn):
- Any source code or test files, including everything under `tests/`
- The generated `audit/` directory (auditor output)
- The OpenSpec installation: `openspec/project.md` and any `openspec/*.yaml`/`*.yml` config — so the tooling keeps working
- `.git/`, `.github/`, `.claude/` (commands, agents, and OpenSpec's `opsx` commands/skills live here), `CLAUDE.md`
- `LICENSE*` (legal — keep)
- Build/config/dependency manifests and functional text files: `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`/`go.sum`, `requirements*.txt`, `constraints*.txt`, any `*.lock`, `Makefile`, `Dockerfile`, CI configs, `.env*`

Steps:
1. Safety: `git rev-parse --is-inside-work-tree`. If not a git repo, STOP (deletion must be reversible). Run `git status --porcelain`; if dirty, recommend commit/stash first.
2. Safety branch: `git switch -c chore/clean-slate-$(date +%Y%m%d-%H%M%S)`.
3. Build the deletion set from `git ls-files` (tracked files only) matching the IN-SCOPE patterns, then subtract every PROTECTED pattern.
4. Print the resulting list grouped as [Documentation] and [OpenSpec content], with a total count.
5. DRY-RUN (default): stop here. Show the exact `git rm` commands that WOULD run and ask the user to re-run with `--confirm`.
6. `--confirm`: remove with `git rm -r <path>` (tracked) and `rm -rf <path>` (untracked in-scope only). Then `git commit -m "chore: clean slate (docs + OpenSpec content)"`.
7. Summarize: files removed, branch name, and how to undo (before pushing: `git switch - && git branch -D <branch>`; after: `git revert <commit>`). Note: for a FULL OpenSpec reset, re-run `openspec init --tools claude`.
