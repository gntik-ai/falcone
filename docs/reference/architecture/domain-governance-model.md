# Domain Governance Model

This note complements `ADR 0007` and the machine-readable contract in `services/internal-contracts/src/domain-model.json`.

## Goal

Give the platform one reusable governance vocabulary for memberships, invitations, plans, quotas, deployment profiles, provider capabilities, and effective capability resolution.

## Canonical governance entities

| Entity | Scope | Purpose |
| --- | --- | --- |
| `tenant_membership` | tenant | Auditable tenant role binding for one human user |
| `workspace_membership` | workspace | Auditable workspace role binding for one human user |
| `invitation` | tenant | Tenant/workspace onboarding record without raw secret material |
| `plan` | platform | Commercial entitlement bundle |
| `quota_policy` | platform | Deterministic limits and enforcement policy |
| `deployment_profile` | platform | Technical topology and plane binding baseline |
| `provider_capability` | platform | Provider-backed feature availability and support metadata |

## Business state machines

The canonical model keeps generic entity lifecycle states, but also introduces explicit governance state machines for:

- membership status (`pending_activation`, `active`, `suspended`, `revoked`)
- invitation status (`pending`, `accepted`, `revoked`, `expired`)
- plan status (`draft`, `active`, `grandfathered`, `retired`)
- quota governance status (`nominal`, `warning`, `throttled`, `blocked`)

These states are machine-readable so later identity, billing, and quota code can reuse the same transition vocabulary.

## Catalog mapping

The governance catalog links four layers:

```text
commercial plan
  -> quota policy
  -> deployment profile
       -> provider capabilities
```

### Interpretation rule

A feature is effectively enabled only when:

1. the commercial plan grants it
2. the deployment profile includes the required provider capability
3. the provider capability is available for the target environment
4. no quota or safety guardrail blocks the workflow

## Plane separation

Every deployment profile and resolved capability keeps plane labels explicit:

- `control`
- `data`
- `identity`
- `observability`

This preserves operator clarity when commercial or provider changes affect different parts of the platform.

## Effective-capability contract

The serialized result for tenant or workspace scope contains:

- target scope (`tenant` or `workspace`)
- tenant/workspace identifiers
- resolved plan and deployment profile ids
- resolved quotas with enforcement mode
- resolved capabilities with provider, plane, environment support, and enablement reason
- correlation metadata for audit and troubleshooting

## Reference scenarios

The machine-readable model also carries plan-change scenarios that exercise:

1. starter → growth upgrade enabling Kafka, functions, and broader observability
2. growth → starter downgrade blocked by current usage and stricter limits
3. regulated → enterprise upgrade enabling federated control and longer trace retention

Use those scenarios before inventing new downgrade/upgrade behaviors in later stories.
