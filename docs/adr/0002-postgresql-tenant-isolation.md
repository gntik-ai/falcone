# ADR 0002: PostgreSQL tenant isolation model

## Status

Accepted

## Date

2026-03-23

## Context

The platform is a multi-tenant BaaS inspired by Firebase and Supabase, with a unified REST surface, realtime capabilities, quotas, invitations, auditability, and an administrative console. PostgreSQL is already fixed as the relational database technology.

This project needs an explicit PostgreSQL isolation decision before it designs:

- PostgreSQL-backed data APIs
- tenant provisioning and lifecycle automation
- migration and DDL workflows
- quota, audit, and observability metadata
- enterprise/compliance escalation paths

The decision must balance:

- security and blast-radius containment
- cost efficiency for many tenants
- operational scalability
- safe migrations and rollback
- compatibility with future premium or regulated tenants

## Decision Drivers

1. **Isolation strength**: cross-tenant data exposure must be prevented by default and reviewed through explicit privilege boundaries.
2. **Economic viability**: the default model must support many tenants without universal dedicated-database cost.
3. **Operability**: provisioning, migrations, backups, and observability must remain automatable.
4. **Reversibility**: the decision must support promotion to stronger isolation without redesigning the product contract.
5. **Auditability**: placement, migrations, grants, and RLS coverage must be inspectable.

## Options Considered

| Option | Security | Cost | Operability | Migration/DDL | Strategic flexibility |
|--------|----------|------|-------------|---------------|-----------------------|
| Shared database, schema-per-tenant + RLS on shared tables | Good default isolation with defense-in-depth on shared data, but still shared blast radius | Best shared economics | Moderate complexity | Requires strict qualification and schema fan-out discipline | Good promotion path because schemas already exist |
| Database-per-tenant | Strongest native isolation and simplest tenant-specific restore story | Highest baseline cost | Highest operational overhead | Large migration fan-out and connection fleet | Strong isolation, weaker economics for small tenants |
| Hybrid placement model | Matches isolation to tenant needs while preserving defense-in-depth | Better economics than universal dedicated DB | Highest governance complexity | Requires metadata-driven placement and standardized contracts | Best overall flexibility |

### Option A — Shared database with schema-per-tenant + RLS on shared tables

Use one PostgreSQL database for the shared environment. Each tenant receives its own schema for tenant-owned tables. Shared control-plane tables remain in shared schemas and use RLS when they contain tenant-scoped rows.

**Pros**
- Efficient default for many small and medium tenants.
- Cleaner tenant export boundary than row-only multi-tenancy.
- Easier to operate than one database per tenant.

**Cons**
- Shared compute/storage still create some noisy-neighbor and incident blast radius.
- Requires excellent discipline around DDL qualification, `search_path`, and grants.
- Tenant counts increase schema lifecycle overhead.

### Option B — Database-per-tenant

Provision one PostgreSQL database per tenant.

**Pros**
- Strongest native isolation within PostgreSQL.
- Straightforward per-tenant backup/restore and maintenance actions.
- Less reliance on RLS for tenant-owned data.

**Cons**
- Highest cost and operational burden.
- Harder to scale connection management and migrations early.
- Prematurely optimizes for the most demanding tenants.

### Option C — Hybrid placement model

Support both shared-schema placement and dedicated-database placement behind one logical product contract.

**Pros**
- Aligns default cost with most tenants while keeping a stronger-isolation path.
- Supports enterprise, regulated, or high-scale tenants without redesigning the platform.
- Fits the platform governance model already needed for quotas, audit, and provisioning.

**Cons**
- Introduces policy and metadata complexity.
- Requires discipline to avoid divergent shared-vs-dedicated behavior.
- Needs clear rules for migrations, grants, and observability across both modes.

## Decision

Adopt a **hybrid PostgreSQL tenant placement model**.

### Default operating mode

The default placement for general tenants is:

- a **shared PostgreSQL cluster/database**
- **one schema per tenant** for tenant-owned relational objects
- **shared control-plane schemas** for platform metadata
- **mandatory RLS** on any shared table that stores tenant-scoped rows

### Escalation path

The platform must support **dedicated database placement** for tenants that meet documented escalation triggers, such as:

- regulatory or contractual isolation requirements
- sustained noisy-neighbor risk that cannot be mitigated in shared placement
- recovery or maintenance requirements that need tenant-specific database operations
- enterprise tier commitments that require stricter physical separation

### What this means in practice

1. **Schema-per-tenant is the default delivery contract**, not the universal end state.
2. **RLS is mandatory for shared tables containing tenant-scoped data** because schema isolation alone does not protect shared metadata tables.
3. **Placement is a metadata-governed decision**, not an ad hoc operational exception.
4. **Dedicated-database promotion must preserve the same logical tenant contract** so downstream services do not need product-level branching.

## Guardrails

### Metadata inventory

Future implementation work must maintain auditable metadata for at least:

- tenant placement mode
- tenant-to-cluster/database/schema binding
- schema/database lifecycle events
- migration history by scope
- role/grant inventory
- RLS policy inventory
- isolation verification evidence

Reference: `specs/us-prg-02-t01/data-model.md`

### Grants and role separation

- Runtime roles must not own schemas and must not run DDL.
- Provisioner/migrator roles handle schema/database creation and migrations.
- Read-only audit roles may inspect evidence but must not alter tenant data.
- Break-glass roles are exceptional, separately controlled, and fully audited.
- `public` schema access must be reduced to the minimum required; application access must not rely on permissive defaults.

Reference: `docs/reference/postgresql/tenant-isolation-baseline.sql`

### RLS expectations

- Any shared table carrying tenant-scoped rows must have RLS enabled.
- RLS policies must derive tenant context from a controlled, transaction-scoped runtime mechanism.
- Shared tables without tenant-scoped rows must still be reviewed so they do not become implicit leakage paths later.
- RLS is not a substitute for narrow grants; both are required.

### Safe migrations and DDL

- Migrations must be **fully qualified**; unqualified object names are not acceptable.
- Shared control-plane migrations and tenant-schema migrations must be tracked separately.
- Rollouts should follow **expand / migrate / contract** where reversibility matters.
- Shared-placement migrations must be designed for fan-out across many schemas.
- Dedicated-placement migrations must remain logically compatible with the shared contract.
- Runtime application flows must not rely on ad hoc schema creation.

### Observability and auditability

- Every placement change must create durable audit evidence.
- Migration success/failure must be attributable to a target scope.
- Isolation verification results must be retained for both shared and dedicated placements.

## Consequences

### Positive

- Keeps the common case economically viable.
- Gives the platform a defined path for stricter isolation without redesign.
- Makes tenant placement an explicit governance concern rather than hidden operational folklore.
- Creates clear prerequisites for the PostgreSQL Data API and provisioning tasks.

### Negative

- Requires policy-driven placement metadata from the beginning.
- Increases implementation complexity versus a single universal placement model.
- Demands consistent privilege and migration discipline to avoid hidden divergence.
- Some future tooling must understand both shared-schema and dedicated-database targets.

## Rollout and Rollback

### Expected rollout path

1. Start with shared-schema placement as the default for new tenants.
2. Build all PostgreSQL automation against the placement metadata model, not against hard-coded shared assumptions.
3. Treat dedicated-database support as a first-class supported placement even if adoption starts with a small subset of tenants.

### Rollback path if shared placement proves insufficient for a tenant class

1. Freeze new shared placements for the affected tenant class.
2. Require dedicated-database placement for new tenants in that class.
3. Export or replicate the affected tenant schema into a dedicated database target.
4. Reapply compatible schema migrations and privilege baselines.
5. Run tenant-isolation verification against the dedicated target.
6. Update placement metadata and connection resolution.
7. Retire the old shared placement only after validation and audit evidence are complete.

### Rollback path if a migration or privilege change threatens isolation

1. Revoke or disable the affected runtime path.
2. Restore the last known-good privilege or migration state for the impacted target scope.
3. Re-run tenant-isolation verification.
4. Block further rollout until the cause is documented and corrected.

## Out of Scope

This ADR does not decide:

- MongoDB isolation
- object storage provider selection
- PostgreSQL Data API design
- multi-service provisioning orchestration details
- realtime/event gateway architecture
