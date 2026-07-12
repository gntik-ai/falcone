# Domain Model

The platform's core entities and their relationships are defined in `packages/internal-contracts/src/domain-model.json` (validated by `npm run validate:domain-model`). This page summarizes that model.

## Entities

| Entity | What it represents |
| --- | --- |
| **platform_user** | A human operator identity, bound to tenant/workspace memberships. |
| **tenant** | The commercial & operational boundary for one customer account (plan, placement). The top-level isolation unit. |
| **workspace** | A tenant-owned delivery boundary for one runtime environment and its resources. |
| **external_application** | An application registration owned by a workspace (client metadata, redirect URIs). |
| **service_account** | A non-human workload identity owned by a workspace, for automation and least-privilege access. |
| **managed_resource** | A registry entry for a provisioned workspace-owned backing resource (database, bucket, topic…). |
| **tenant_membership** / **workspace_membership** | Auditable bindings of a user to a role set at tenant / workspace scope. |
| **invitation** | Onboarding record to bring a user into tenant or workspace scope. |
| **plan** | A commercial plan grouping entitlements, quota policy and a default deployment profile. |
| **quota_policy** | Reusable definition of enforced limits and overage behaviour. |
| **deployment_profile** | A technical profile capturing topology and provider support. |
| **provider_capability** | A provider-backed technical capability that a deployment profile can expose or constrain. |

The model also defines audit records for governed **function** lifecycle actions (deployment, admin actions, rollback evidence, quota enforcement) — the platform keeps a query-safe audit trail for sensitive operations.

The AI-native capabilities *(Preview)* carry their own workspace-scoped resource models alongside this core domain: **Flows** define flow definitions, immutable versions and executions (schema `flow-definition.json`; see the [Workflow DSL Reference](/architecture/workflow-dsl-reference)), and **MCP server hosting** defines per-tenant MCP servers with digest-pinned versions and curated tool sets (see [MCP Architecture](/architecture/mcp)). Both are tenant/workspace-scoped and audited like every other resource.

## Relationships

```
platform_user ──many_to_many──▶ tenant         (membership)
platform_user ──many_to_many──▶ workspace       (membership)

tenant ──one_to_many (required)──▶ workspace             (parent/child)
tenant ──one_to_many──▶ tenant_membership                (governance)
tenant ──one_to_many──▶ invitation                       (governance)

workspace ──one_to_many──▶ external_application          (parent/child)
workspace ──one_to_many──▶ service_account               (parent/child)
workspace ──one_to_many──▶ managed_resource              (parent/child)
workspace ──one_to_many──▶ workspace_membership          (governance)

external_application ──many_to_many──▶ service_account   (attachment)
external_application ──many_to_many──▶ managed_resource  (attachment)

plan ──one_to_one (required)──▶ quota_policy             (composition)
plan ──one_to_one (required)──▶ deployment_profile       (composition)
deployment_profile ──many_to_many──▶ provider_capability (catalog)
```

The shape that matters most for isolation: **tenant → workspace → {applications, service accounts, managed resources}**. Every data-plane credential resolves to a `(tenant, workspace)` pair, and all resources hang off a workspace owned by exactly one tenant.

## Lifecycle

Governed entities move through a shared state machine (`lifecycle_transitions`):

```
            create                  activate
   ( ∅ ) ──────────▶ draft ───────────────────▶ active
                       │   ▲                       │
                       │   │ activate              │ suspend
                       │   │                       ▼
                       │   └──────────────────  suspended
                       │                           │
                       └────────┬──────────────────┘
                                ▼  soft_delete
                           soft_deleted
```

- **create** allocates canonical identifiers and persists the entity (in `draft`) before any downstream provisioning.
- **activate** makes it operational (from `draft`, `provisioning` or `suspended`).
- **suspend** retains identifiers and ownership while preventing active use.
- **soft_delete** removes the entity from active listings while preserving it for audit and cascading cleanup.

Soft deletion (rather than hard delete) is what lets the platform deprovision a tenant or workspace and cascade cleanup of its resources **without orphaning cross-tenant data** — a core multi-tenant lifecycle requirement.

## Plans, quotas & entitlements

A **plan** composes a **quota_policy** (enforced limits + overage behaviour) and a **deployment_profile** (topology + provider capabilities). The effective capabilities for a tenant resolve from its plan, and plan changes follow defined scenarios (`plan_change_scenarios` in the model). The console surfaces this as the Plans, Plan detail and Quotas views.
