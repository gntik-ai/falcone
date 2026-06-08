---
description: Turn the latest Playwright E2E failures into OpenSpec changes + GitHub issues (label e2e). Dry-run by default.
argument-hint: "[--confirm]   (default: --dry-run)"
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---
Capture E2E failures and publish them as OpenSpec-backed issues. Requires a previous `/run-e2e` or `/e2e-issue` run. Args: $ARGUMENTS.

1. Parse `tests/e2e/test-results/results.json` (JSON reporter) plus traces/screenshots. For each failed spec, read its header to get the `us-…`/`uc-…`/`fn-…` it covers.
2. Normalize the findings into `audit/e2e-failures.md`: id `e2e-NNN`, story/use case, failing spec path, the step that failed, expected vs actual, artifact paths, suspected code area (`path::symbol` if identifiable), severity (cross-tenant exposure = Critical).
3. For each finding (skip known flakes), create the OpenSpec change with the **propose** workflow (`/opsx:propose fix-…`), validate `openspec validate <change-id> --strict`, and build the issue body (same OpenSpec template, including the Resolution section). Labels: `bug`, `e2e`, `P0|P1|P2`, `cap:<name>`, `tenant-isolation` if cross-tenant, always `openspec`.
4. DRY-RUN by default: print the table (title, labels, change-id) + the exact `gh` commands. With `--confirm`: create via `gh issue create`. Idempotent by change-id.

Prefer delegating to the `issue-reporter` subagent. Then resolve with the usual pattern: `/fix-bug <change-id>` — the reproduction is the failing spec itself (`bash tests/e2e/run-issue.sh <change-id>`).
