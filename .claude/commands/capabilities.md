---
description: Extract capabilities and functionalities from source. Writes audit/capabilities.md and audit/functionalities.md.
argument-hint: "[capability or path to focus on]   (optional)"
allowed-tools: Read, Grep, Glob, Bash, Write
---
Derive Falcone's capabilities (`cap-…`) and functionalities (`fn-…`) from source code only, each anchored to code evidence. Focus: $ARGUMENTS.
Use `audit/recon.md` if present. Prefer delegating to the `capability-extractor` subagent.
Write `audit/capabilities.md` and `audit/functionalities.md`. Output a short summary + paths.
