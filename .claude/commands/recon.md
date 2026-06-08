---
description: Map the codebase from source only — languages, modules, entry points, public surface. Writes audit/recon.md.
argument-hint: "[path to focus on]   (optional)"
allowed-tools: Read, Grep, Glob, Bash, Write
---
Map the repository from source code only (ignore documentation). Focus: $ARGUMENTS (default: whole repo).
Produce: stack summary, module map (module → responsibility → public symbols → paths), and the public surface (CLI/endpoints/public functions) a black-box test could reach.
Write `audit/recon.md`. Prefer delegating to the `code-cartographer` subagent. Output a short summary + path.
