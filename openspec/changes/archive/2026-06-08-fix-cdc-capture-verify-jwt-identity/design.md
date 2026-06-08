## Context

All eight CDC capture actions share a `decodeAuth` helper that base64url-decodes the JWT payload (the middle segment of the Bearer token) and reads `tenant_id` / `workspace_id` directly from the claims object. No signature verification, issuer check, audience check, or expiry check is performed. The APISIX gateway already injects authoritative `X-Tenant-Id`, `X-Workspace-Id`, and `X-Auth-Subject` headers from the verified token before forwarding to OpenWhisk actions, as demonstrated by `services/gateway-config/base/public-api-routing.yaml:211-218`. The scheduling engine already follows the correct pattern in `services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity`.

## Goals / Non-Goals

**Goals:**
- Eliminate unverified-JWT-payload trust in all eight CDC capture actions.
- Align CDC identity sourcing with the established `parseIdentity` pattern.
- Ensure a forged unsigned Bearer token cannot set tenant scope.

**Non-Goals:**
- Changing the APISIX gateway configuration (it is already correct).
- Adding JWKS signature verification to these actions (the trusted-header pattern is simpler and consistent with the codebase standard).
- Modifying the CDC capture data model or API surface.

## Decisions

**Decision: Use gateway headers, not JWKS verification.**
Rationale: The scheduling engine's `parseIdentity` is the established, code-reviewed pattern. Introducing JWKS fetching into these actions would add latency, a new dependency (JWKS endpoint), and complexity without additional security benefit, because the gateway already performs signature verification before injecting the headers.

**Alternative considered:** Perform full JWKS signature + iss/aud/exp verification (as `realtime-gateway/src/auth/token-validator.mjs`). Rejected: heavier, inconsistent with the existing action pattern, and doesn't fix the root cause (the actions shouldn't be trusting unverified token payloads at all).

## Risks / Trade-offs

**Risk:** Actions deployed without the gateway (direct OpenWhisk invocation, local dev, test harness) will now always return 401 unless gateway headers are injected.
**Mitigation:** Test fixtures and local integration environments must supply the trusted headers, which is consistent with how scheduling-engine tests already work. Document the required headers in action-level test setup.

**Risk:** If the gateway is misconfigured and stops injecting the headers, all CDC actions return 401.
**Mitigation:** This is the correct fail-safe behaviour; it prevents inadvertent exposure rather than allowing unscoped access.

## Migration Plan

No schema or API changes. The fix is a drop-in replacement of the identity-parsing helper in each action. Existing clients that route through APISIX see no change. Direct-access clients (if any exist outside the gateway) will need to supply the gateway headers.
