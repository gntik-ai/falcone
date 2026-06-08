---
description: Propose ADVANCED features inferred from real code gaps. Writes audit/proposed-features.md.
allowed-tools: Read, Grep, Glob, Bash, Write
---
Propose advanced, high-value features for Falcone (a multitenant BaaS) based only on real gaps in the code. For each: rationale tied to code evidence (`path::symbol`), proposed behavior, affected capabilities, priority, risk.
Prefer delegating to the `feature-proposer` subagent. Write `audit/proposed-features.md` (priority-ordered). Output a short summary + path.
