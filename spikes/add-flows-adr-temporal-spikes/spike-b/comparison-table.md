# EPHEMERAL SPIKE — not production code

## Spike B — tenancy model comparison table

Derived from measured data in `measurements.md` / `evidence/measurements.json`
(N = {1, 5, 20}, per-worker pollers = 4).

| Dimension | Namespace-per-tenant | Shared namespace + `tenantId` search attribute |
|---|---|---|
| **Isolation boundary** | Hard — separate namespace, history, and visibility partition per tenant; cross-tenant access is impossible at the Temporal API level | Soft — single namespace; isolation enforced by the `tenantId` search-attribute filter on every visibility query (PostgreSQL store; proven zero-leak in this spike) |
| **Poller count per N tenants** | `N × 4` (measured: 4 / 20 / 80 for N = 1 / 5 / 20) — linear in N | `4` flat (measured: 4 / 4 / 4 for N = 1 / 5 / 20) — constant, independent of N |
| **gRPC connection count per N tenants** | super-linear in aggregate (measured: 4 / 60 / 840 total for N = 1 / 5 / 20; one worker process and its connection set per tenant) | `4` flat (measured: 4 / 4 / 4) — one worker pool, one connection set regardless of N |
| **Operational complexity** | High — per-tenant namespace provisioning + retention config, one worker process (or lazy-worker logic) per tenant, fleet and connection fan-out that grows with every new tenant | Low — single namespace, single worker pool; new tenants are just a new `tenantId` value; complexity is one query-layer filter to enforce |

**Selected model: Shared namespace + `tenantId` search attribute** (recorded in ADR-11). The
flat poller/connection profile and low operational complexity outweigh the hard isolation
boundary of namespace-per-tenant, given the PostgreSQL visibility store filters `tenantId` with
zero cross-tenant leakage.
