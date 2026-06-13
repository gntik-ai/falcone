## Context

Falcone's IdP is Keycloak, realm-per-tenant, fronted by the IAM-admin adapter (`services/adapters/src/keycloak-admin.mjs` — client/scope/role/service-account/credential primitives) and the external-application surface (`apps/control-plane/src/external-application-iam.mjs` — OAuth2 apps with HTTPS redirect-URI validation, plan-gated flows). ADR-12 chose to extend this rather than build a new AS. A live spike (`spikes/add-mcp-oauth-authorization-server/`) confirmed end-to-end that a per-tool Keycloak client scope is carried in an issued token.

## Goals / Non-Goals

**Goals:** per-tool scopes, curated DCR, consent, and token lifecycle for tenants' MCP servers — on Keycloak, surfaced through Falcone's API, never exposing raw Keycloak admin to tenants.

**Non-Goals:** gateway token validation / per-tool enforcement (#389); the management/Connect API and UX (#391/#397); curation that *chooses* which scopes a tool needs (#393); quotas (#399).

## Decisions

- **Per-tool scope = Keycloak client scope.** Each curated tool maps to a client scope `mcp:<server>:<tool>` with `include.in.token.scope=true` and consent text from the tool description. Proven live (token carried `mcp:tool:echo`). Rationale: reuses Keycloak's native scope/consent/token machinery; the gateway (#389) and the server SDK (#401) both read the `scope` claim.
- **Curated DCR, not raw.** Clients register **through the control-plane** (Falcone issues the Keycloak client via the IAM-admin adapter, tenant-scoped, plan-limited, HTTPS-redirect-validated). The raw Keycloak `clients-registrations` endpoint and admin API are never exposed to tenants — avoids a privilege-escalation footgun while still offering DCR ergonomics. *Alternative:* expose Keycloak DCR directly — rejected (tenant could self-grant scopes/roles).
- **Consent reuses the approval-flow precedent** (`wf-con-001-user-approval`), recording consent per (user, client, scopes).
- **Token lifecycle reuses credential primitives** (`generateClientCredential` / `rotateClientCredential` / `revokeClientCredential`); revoked tokens are rejected at the gateway (#389).
- **HTTPS redirect validation reused** from `external-application-iam.mjs` (reject non-HTTPS redirect URIs).

## Risks / Trade-offs

- *Tenant self-granting scopes via DCR* → mitigated by curating registration through the control-plane (the tenant never talks to Keycloak admin directly).
- *Scope sprawl (one scope per tool)* → acceptable; curation (#393) prunes tools, bounding scope count.
- *Token TTL vs. long-running tool calls* → use refresh tokens / the Tasks extension (#395) for long work rather than long-lived access tokens.

## Migration Plan

Additive: no change to existing OAuth2-app behavior. The MCP OAuth surface is new and gated by MCP being enabled for the tenant. Rollback = remove the MCP OAuth routes/helpers; per-tenant Keycloak clients/scopes are removed by the MCP teardown (#388) / tenant purge.

## Open Questions

- Scope granularity: per-tool vs. per-server read/write tiers — start per-tool; revisit if scope counts grow.
- Whether consent is per-scope or per-server — likely per-server with per-tool detail shown.
