---
description: Reproduce + fix a bug from an OpenSpec change — black-box TDD around the OpenSpec apply->verify->archive lifecycle.
argument-hint: "<change-id | issue-number>"
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---
Resolve the bug in $ARGUMENTS using OpenSpec.
1. Inspect the change: `openspec show $1` (and read `openspec/changes/$1/`). Restate the acceptance scenarios.
2. Add or locate a FAILING black-box test that reproduces it (public interface only).
3. Implement with OpenSpec **apply** — `/opsx:apply $1` — working through `tasks.md` with the minimal source fix. Never edit tests to make them pass.
4. Run `bash tests/blackbox/run.sh`. Iterate until green with no regressions.
5. Verify: `/opsx:verify $1` and `openspec validate $1 --strict`.
6. Archive: `/opsx:archive $1` (syncs the delta into `openspec/specs/`, moves the change to archive).

Optional (recommended for UI-facing or tenancy-sensitive changes): before archiving, run `/e2e-issue $1` — it installs + boots the REAL backend and frontend and verifies the scenarios end-to-end.

Prefer delegating to the `bug-fixer` subagent. Output a diff summary, the test + validation result, and the archive confirmation.
