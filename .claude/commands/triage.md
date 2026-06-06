---
description: Turn a code-grounded observation (bug/feature) into an OpenSpec change via the propose workflow.
argument-hint: "<short description of the bug/feature>"
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---
Observation: $ARGUMENTS

Create a reviewable OpenSpec change from code evidence only (never from documentation):
1. Locate the relevant code and gather evidence (`path::symbol[:lines]`).
2. Pick a kebab change-id (`fix-…` for a bug, `add-…` for a feature).
3. Create the change with OpenSpec's **propose** workflow — run `/opsx:propose <change-id>` (or use the OpenSpec skill). It scaffolds `openspec/changes/<change-id>/`: `proposal.md`, `specs/<capability>/spec.md` (delta), `design.md`, `tasks.md`. Feed it the evidence so the proposal and EARS scenarios are code-grounded.
4. Validate: `openspec validate <change-id> --strict`. Fix until clean.

Prefer delegating to the `openspec-author` subagent. Output the change-id, the files OpenSpec created, and the validation result. (Then `/fix-bug` or `/implement-change` resolves it.)
