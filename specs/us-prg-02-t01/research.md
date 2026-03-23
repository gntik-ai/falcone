# Research: PostgreSQL Tenant Isolation

## Decision Drivers

1. **Tenant isolation strength** — prevent cross-tenant data exposure and reduce blast radius.
2. **Unit economics** — support many tenants without forcing one database per tenant from day one.
3. **Operational scalability** — keep provisioning, migrations, observability, and backup/restore manageable.
4. **Migration safety** — allow repeatable DDL with predictable rollback and auditable change history.
5. **Product flexibility** — preserve an upgrade path for tenants that later require stricter isolation.

## Options Compared

### Option A — Shared database with schema-per-tenant + RLS on shared tables

**Summary**: Tenant-owned tables live in a dedicated schema per tenant. Shared control-plane tables remain in shared schemas and are protected with RLS.

**Strengths**
- Stronger isolation than row-only multi-tenancy because tenant-owned objects are namespaced separately.
- Lower cost than database-per-tenant for the common case.
- Easier to standardize backups, upgrades, and connection pooling at platform scale.
- Keeps tenant export and promotion feasible because each tenant already has a schema boundary.

**Risks**
- Shared database still means shared compute, storage, and some blast radius.
- Poorly qualified DDL or loose privileges can break isolation.
- Large tenant counts increase migration fan-out and schema lifecycle management overhead.

### Option B — Database-per-tenant

**Summary**: Each tenant receives a dedicated PostgreSQL database.

**Strengths**
- Strongest native isolation within the same PostgreSQL cluster and simplest story for tenant-specific backup/restore.
- Easier to reason about noisy-neighbor containment and customer-specific operational actions.
- Reduced dependence on RLS for tenant data.

**Risks**
- Highest operational overhead for provisioning, connection management, migration fan-out, and fleet observability.
- Higher baseline cost for small tenants.
- Cross-tenant reporting and platform-wide controls become more complex.
- Can force premature infrastructure automation before product fundamentals stabilize.

### Option C — Hybrid placement model

**Summary**: The platform supports both shared placement and dedicated placement, with policy deciding which tenants can use each.

**Strengths**
- Preserves low-cost shared placement for the common case.
- Keeps a path to stronger isolation for regulated, high-scale, or high-risk tenants.
- Aligns with future enterprise/compliance needs without making them the universal default.

**Risks**
- Adds governance complexity because placement policy and metadata become first-class platform concerns.
- Requires strict contract compatibility across shared and dedicated placements.
- Can devolve into two platforms if privileges, migrations, and observability are not standardized.

## Recommendation

Adopt **Option C — Hybrid placement model**, with **schema-per-tenant in a shared PostgreSQL database as the default operating mode** and **database-per-tenant as a policy-driven escalation path**.

### Why this wins now

- The product is explicitly multi-tenant and needs viable economics for many tenants.
- The project already expects strong governance, auditability, and quotas; a documented placement policy fits that model.
- Schema boundaries make later promotion to dedicated databases materially easier than starting with pure row-based isolation.
- RLS remains mandatory for shared metadata/control-plane tables, so defense-in-depth is preserved where schemas alone are insufficient.
- A hybrid decision preserves room for future compliance or premium tiers without forcing maximum cost and complexity on every tenant today.

## Rejected Defaults

### Why not choose schema-per-tenant-only as the final platform contract?

Because it would leave no explicit architectural answer for tenants that later outgrow the shared blast radius or require stricter contractual isolation.

### Why not choose database-per-tenant as the universal default?

Because it would optimize for worst-case isolation at the expense of early product economics, provisioning simplicity, and delivery speed.

## Implications for Later Tasks

- PostgreSQL Data API work must treat tenant placement metadata as part of connection resolution.
- Provisioning orchestration must support both shared-schema provisioning and dedicated-database promotion.
- Audit and observability design must record tenant placement, migration history, and policy changes.
- MongoDB, object storage, and realtime tasks should mirror the same governance pattern but are not decided here.
