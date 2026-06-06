---
description: Publish bugs + advanced features as OpenSpec changes AND GitHub issues with labels. Requires gh + OpenSpec. Dry-run by default.
argument-hint: "[--confirm] [bugs|features|all] [--severity Critical,High]   (default: --dry-run all)"
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---
Publish findings. Inputs: `audit/bugs.md` and `audit/proposed-features.md`. Args: $ARGUMENTS (default: dry-run, all). Requires `gh auth status` and OpenSpec installed (`openspec init` done).

For each selected item:
1. Create an OpenSpec change with the **propose** workflow — `/opsx:propose <change-id>` (or the OpenSpec skill); kebab `fix-…`/`add-…`. Validate: `openspec validate <change-id> --strict`.
2. Build the issue body from that change and write it to `audit/issues/<change-id>.md`:
   - Change ID, capability, type, priority; a pointer to `openspec/changes/<change-id>/`.
   - Why / What Changes (from `proposal.md`); the spec delta (EARS); the `tasks.md` checklist; acceptance criteria ↔ `bbx-`; code evidence (`path::symbol`).
   - **Resolution (OpenSpec):** `/opsx:apply <change-id>` → `/opsx:verify <change-id>` → `bash tests/blackbox/run.sh` → `/opsx:archive <change-id>` (or `/fix-bug <change-id>` / `/implement-change <change-id>`). Optional real E2E: `/e2e-issue <change-id>` (boots backend + frontend).
3. Labels: `bug`/`enhancement` + `P0|P1|P2` + `cap:<name>` + `security`/`tenant-isolation` where relevant + always `openspec`. Ensure labels exist (`gh label create "<name>" --force`). Idempotent: skip items whose `change-id` already appears in an issue (`gh issue list --search "<change-id> in:body" --state all`).

DRY-RUN (default): print the issues that WOULD be created (title, labels, change-id) and the exact `gh` commands; do not create. `--confirm`: `gh issue create --title "<title>" --body-file audit/issues/<change-id>.md --label "<l1>" --label "<l2>" ...`.

Prefer delegating to the `issue-reporter` subagent. Output per item the change-id, issue URL (or dry-run), and labels; then counts.
