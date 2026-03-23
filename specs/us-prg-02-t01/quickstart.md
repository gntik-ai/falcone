# Quickstart: Using the PostgreSQL Tenant Isolation ADR Package

## Purpose

Use this package before any task that introduces PostgreSQL schemas, grants, connection routing, data APIs, or migration automation.

## Read in this order

1. `docs/adr/0002-postgresql-tenant-isolation.md` — final decision and policy boundaries
2. `specs/us-prg-02-t01/research.md` — option comparison and recommendation rationale
3. `specs/us-prg-02-t01/data-model.md` — required governance metadata
4. `docs/reference/postgresql/tenant-isolation-baseline.sql` — baseline SQL patterns for roles, grants, and RLS context
5. `tests/e2e/postgresql-tenant-isolation/README.md` — tenant-isolation verification matrix

## Rules downstream tasks must inherit

- Default PostgreSQL placement is `shared_schema` unless a documented policy exception requires `dedicated_database`.
- Tenant-owned data must live behind an explicit tenant boundary.
- Shared tables containing tenant-scoped data require RLS; schema isolation alone is insufficient there.
- DDL must be fully qualified and executed by controlled migrator/provisioner roles, never by runtime roles.
- Placement changes must update tenant metadata and produce audit evidence.

## Minimal review checklist for future changes

- Does the change assume a single PostgreSQL placement mode for every tenant?
- Does it preserve the schema-to-database promotion path?
- Does it introduce or modify shared tables carrying tenant-scoped data? If yes, where is the RLS policy?
- Does it rely on runtime DDL or broad grants? If yes, reject or redesign.
- Does it add a new isolation verification scenario?

## Validation

Run from the repository root:

```bash
pnpm validate:adr:postgres
pnpm lint
pnpm test
```
