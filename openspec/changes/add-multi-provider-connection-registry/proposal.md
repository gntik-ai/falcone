# Multiple LLM provider connections: registry and compatibility

## Why

Issue #937 (GAP-FAL-001) currently stores one LLM provider per workspace. Configuring
another provider overwrites the existing provider. This change implements part (a)
of the operator's 2026-10-16 amendment.

## What changes

- Add a tenant-scoped registry of up to 32 named LLM connections per workspace.
- Add collection and item APIs with structural-write authorization and BYOK guards.
- Keep singular APIs and unselected completions operating on the default connection.
- Copy legacy rows once and mirror old-executor writes throughout rolling upgrades.
- Add blackbox and PostgreSQL 17 checks to CI.

## Scope

Source repository only. Named selection in completions, worker tasks, embeddings,
model discovery, usage per connection, console UI and chart changes are excluded.
The legacy table, unique constraint and mirror trigger remain in place.
