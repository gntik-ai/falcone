# Define large-task worker security profile (part a)

## Why

GAP-FAL-009 and issue #948 identify the absence of a reusable contract for long,
disk-heavy work with tenant isolation, bounded resources, controlled egress,
approved entrypoints and no inherited credentials.

## What changes

- Add a version 1, closed operator profile with immutable defaults, digest-only
  image approvals, per-image env approvals and explicit sandbox opt-in.
- Add pure Job and NetworkPolicy builders that fail closed without applying
  anything, plus deterministic termination classification and audit projection.
- Document all fields, trust assumptions and deployment prerequisites, and
  cover the contract with unit and documentation tests.

## Scope and decisions

D1 splits the pure contract (this change) from applying, watching, heartbeat,
cancel, Flows integration and artifact credentials (part b). D2 requires a
sandbox RuntimeClass only for opted-in code execution. D3 permits egress only
to named DNS/platform namespaces; empty lists permit no namespace.

This is additive source-only work. Existing MCP builders, image pinning helpers,
runtime paths, workflow activities, function sandbox, charts and deployment files
are unchanged. Installing runtimes, RBAC, egress proxies, image scanning and
provenance are outside scope. No migration or deployment is needed; rollback is
a revert of this additive change.
