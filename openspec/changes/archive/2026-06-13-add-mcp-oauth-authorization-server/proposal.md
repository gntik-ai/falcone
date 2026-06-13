## Why

Remote MCP servers require **OAuth 2.1** with scoped tokens, consent, and dynamic client registration. ADR-12 decided to **extend the existing realm-per-tenant Keycloak** as the Authorization Server rather than build a greenfield AS — Keycloak already exposes the DCR endpoint and the `authorization_code`/`client_credentials`/`refresh_token` grants (#387 evidence), and a live spike on `test-cluster-b` proved that a **per-tool scope modeled as a Keycloak client scope is carried in the issued token** (`token.scope = "mcp:tool:echo …"`). This change wires that into Falcone's IAM surface so tenants' MCP servers get OAuth 2.1 authorization. It resolves issue **#390** (P0, epic #386); depends on #387; feeds #389 (gateway validates tokens + enforces per-tool scope), #393 (curation assigns scopes), #391/#394 (the clients).

## What Changes

- Extend the control-plane IAM surface (building on `apps/control-plane/src/external-application-iam.mjs` and the `services/adapters/src/keycloak-admin.mjs` adapter) to manage MCP OAuth:
  - **Per-tool scopes** modeled as Keycloak **client scopes** (`mcp:<server>:<tool>`), with `include.in.token.scope` and consent-screen text derived from the tool description.
  - **Curated dynamic client registration** — MCP clients are registered **through Falcone** (tenant-scoped, plan-enforced limits, **HTTPS redirect-URI validation** reusing the existing validator); the **raw Keycloak admin / DCR endpoints are never exposed to tenants**.
  - **Consent** for end-users authorizing an MCP client (reuse the `wf-con-001-user-approval` approval-flow pattern).
  - **Token lifecycle** — issuance, refresh, and revocation per OAuth client (reuse the existing credential rotation/revoke primitives), credential-derived tenant (ADR-2).
- A pure-function helper module (`mcp-oauth`) that derives per-tool client-scope definitions from a tool manifest and builds the curated client-registration request, fully unit-testable.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `mcp`: add OAuth 2.1 Authorization Server requirements — per-tool scopes, curated dynamic client registration with HTTPS redirect validation, consent, and token lifecycle, served by the tenant's Keycloak realm. Builds on the foundational `mcp` capability (#387).

## Impact

- **Control-plane:** new `mcp-oauth` helpers + management routes (register client, list/assign per-tool scopes, consent, revoke), built on `external-application-iam.mjs` + `keycloak-admin.mjs`.
- **Reuses:** Keycloak realm-per-tenant IdP, the IAM-admin adapter (client/scope/service-account/credential primitives), the HTTPS redirect-URI validator.
- **No raw Keycloak admin exposed to tenants.** Gateway token validation + per-tool scope enforcement is #389. Token issuance is here.
- **Validated live** on `test-cluster-b` Keycloak (throwaway realm, cleaned up): per-tool-scoped token issued to a registered client.
