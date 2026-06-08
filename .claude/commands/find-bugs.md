---
description: Identify bugs/defects from source (multitenancy first). Writes audit/bugs.md.
argument-hint: "[path / capability to focus on]   (optional)"
allowed-tools: Read, Grep, Glob, Bash, Write
---
Identify defects in Falcone from source code only — multitenancy first (cross-tenant leakage / IDOR), then correctness, security, reliability, and coverage-implied gaps. Focus: $ARGUMENTS.
First run `/audit-isolation` (or delegate to `tenant-isolation-auditor`) and fold in the `iso-*` findings. Then prefer delegating to the `bug-hunter` subagent.
Write `audit/bugs.md` (severity-ranked). Output a short summary + path. Do not fix.
