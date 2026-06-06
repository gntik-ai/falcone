---
description: Implement a NEW feature from an OpenSpec change, test-first, via the OpenSpec apply->verify->archive lifecycle.
argument-hint: "<change-id>"
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---
Implement change $1 using OpenSpec.
1. Inspect the change: `openspec show $1` (proposal, design, spec delta, tasks).
2. Add black-box tests for every `#### Scenario:` (public interface only).
3. Implement with OpenSpec **apply** — `/opsx:apply $1` — through `tasks.md`, following conventions inferred from the codebase.
4. Run `bash tests/blackbox/run.sh`; iterate to green.
5. Verify: `/opsx:verify $1` and `openspec validate $1 --strict`. If the implementation diverges from the spec, update the change and re-validate.
6. Archive: `/opsx:archive $1`.

Optional (recommended for UI-facing or tenancy-sensitive changes): before archiving, run `/e2e-issue $1` — it installs + boots the REAL backend and frontend and verifies the scenarios end-to-end.

Prefer delegating to the `feature-builder` subagent. Output files changed, new `bbx` IDs, verify/validation results, and the archive confirmation.
