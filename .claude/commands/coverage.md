---
description: Build the functionality-to-code-to-tests coverage matrix from source. Writes audit/coverage.md.
allowed-tools: Read, Grep, Glob, Bash, Write
---
Build the coverage matrix for the functionalities in `audit/functionalities.md`: code location, existing tests, coverage status, and risk notes (flag tenancy-sensitive gaps).
Prefer delegating to the `coverage-analyst` subagent. Write `audit/coverage.md`. Output a short summary + path.
