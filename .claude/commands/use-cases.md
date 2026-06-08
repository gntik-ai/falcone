---
description: Write detailed use cases per functionality from source. Writes audit/use-cases.md.
argument-hint: "[capability to focus on]   (optional)"
allowed-tools: Read, Grep, Glob, Bash, Write
---
Write detailed, code-grounded use cases (`uc-…`) for the functionalities in `audit/functionalities.md`, making the tenant context explicit. Focus: $ARGUMENTS.
Prefer delegating to the `use-case-writer` subagent. Write `audit/use-cases.md`. Output a short summary + path.
