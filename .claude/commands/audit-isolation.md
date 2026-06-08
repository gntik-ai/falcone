---
description: Audit multitenant data isolation in Falcone — hunt for cross-tenant leakage (IDOR), missing tenant scoping, and unsafe tenant context propagation. Read-only.
argument-hint: "[path / module / capability to focus on]   (optional; default: whole repo)"
allowed-tools: Read, Grep, Glob, Bash
---
Run a tenant-isolation audit over: $ARGUMENTS (default: the whole repository).

Goal: find any path where a request authenticated for one tenant could read or affect another tenant's data. Source code only; do not modify anything.

1. Map the tenancy model and the real tenant key (e.g. `tenant_id` / `org_id` / `workspace_id`).
2. Trace tenant propagation from entry → service → data layer → background jobs.
3. Audit every data-access path, authorization check, DB-enforced isolation, and tenant lifecycle / shared state.
4. Produce a severity-ranked findings report (`iso-NNN`), each with location, evidence, risk, a suggested black-box probe, and confidence.

Prefer delegating to the `tenant-isolation-auditor` subagent. Then recommend next steps: `/triage` the Critical/High findings into OpenSpec changes and have `blackbox-test-author` implement the isolation `bbx` tests. Do not fix here.
