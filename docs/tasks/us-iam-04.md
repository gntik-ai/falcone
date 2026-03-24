# US-IAM-04 — Invitaciones, membresías, políticas internas y rotación de credenciales

## Scope delivered

- Invitation lifecycle for tenant/workspace targets with acceptance, expiration policy, and revocation contracts.
- Canonical tenant/workspace membership role-mapping provenance from Keycloak users and groups.
- Workspace service-account credential issuance, rotation, and revocation modeled as secret-free control-plane contracts.
- Cross-product managed-resource access policies aligned with the contextual authorization matrix.
- Configurable expiration policies for invitations, human credentials, service credentials, and console sessions.
- Gateway access-matrix coverage for owner, admin, developer, viewer, and service-account identities.

## Contract changes

- OpenAPI bumped to `1.5.0` with invitation acceptance/revocation endpoints and service-account credential lifecycle endpoints.
- Domain model strengthened with invitation target bindings, membership role mappings, managed-resource access policies, and service-account credential state.
- Authorization model extended with `tenant_owner`, `workspace_owner`, and `workspace_service_account` plus lifecycle-aware IAM actions.
- Internal service map enriched with invitation/membership reconciliation and service-account credential rotation orchestration flows.
- Helm values and schema now expose explicit expiration policies for invitations, human credentials, service credentials, and sessions.

## Validation intent

- Keep the implementation additive and auditable.
- Preserve strict tenant/workspace isolation in identity reconciliation and credential handling.
- Avoid raw-secret material in canonical models, route catalog artifacts, and reference fixtures.
