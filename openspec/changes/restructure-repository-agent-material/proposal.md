# Separate agent/process material: safe phase 1

## Why

Falcone's public source root mixes product files, agent memory and process artifacts.
Those artifacts are retained working memory and evidence. Hermes depends on the
current paths, so relocation needs deployed dual-layout support first.

## Approved change

Issue #1099, request f0ee7e5f-e3c6-48ee-9dd5-7db0b31c3ce3 revision 2, risk R2.
Inventory every tracked file through disjoint recursive rules, with git-grep reader
citations and nested counts. Record the .engineering/ design and exact reader plan,
historical allowlist rules, and external Hermes blockers. Keep OpenSpec at root.
Delete the four accidental .idea files and ignore /.idea/. Explain the current
layout in README.md and CONTRIBUTING.md. No moves and no symlinks in phase 1.

## Acceptance

- Stored commands reproduce the phase-1 tracked inventory; all files have one
  class directly or recursively, with matching counts and reader evidence.
- OpenSpec tracking despite .gitignore:50 is proved and new files are force-added.
- Reader conditions depend on the target moved; all tracked grep hits have expected
  diffs or explicit exemptions, including both ADR citations and track-f references.
- Phase-2 map, baseline identification, eligibility and blob checks are deterministic.
- Only IDE deletions, .gitignore, README, CONTRIBUTING and this change are touched.
- All existing lint, unit, blackbox and PR workflow gates remain required.

## Scope and impact

No product, workflow, docs-site build, deployment or Helm behavior changes. No agent
memory deletion or edits. Preserve GAP-001 manifest bytes and record present/missing
entries. Phase 2 is separately approved and blocked on external owner confirmations
and deployed Hermes evidence. See inventory.md, design.md and tasks.md.
