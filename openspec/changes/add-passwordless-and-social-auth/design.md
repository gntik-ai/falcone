# Design — add-passwordless-and-social-auth

## Goals

1. A web client can call `client.auth.signInWithOtp({ email })` and a working sign-in
   experience appears in the user's inbox within seconds.
2. Tenants enable "Login with Google" by pasting an OAuth client id/secret and a
   pre-populated redirect URI; no Keycloak admin knowledge required.
3. End-user tokens are isolated per workspace: no token issued for workspace A is ever
   valid for workspace B, regardless of provider.
4. The four most-abused vectors (password spraying, magic-link harvesting, OTP brute
   force, OAuth replay) have first-class mitigations.

## Non-goals

- **SAML / WebAuthn / Passkeys.** Tracked separately. The shape here generalises to
  them (a `provider` enum value + a few capability hints) but they are not in scope.
- **Custom hosted UI.** We return tokens and challenge IDs; tenants render their own UI.
  A Falcone-hosted login widget can be a follow-up.
- **Identity-graph / progressive profiling.** Out of scope; covered by a future
  `add-user-profiles` proposal that owns per-workspace user metadata schemas.

## End-user realm vs. operator realm

Two parallel Keycloak realms per deployment:

```
master realm           — Keycloak admin only.
falcone-operators      — platform operators (existing).
ws-{workspaceSlug}     — one realm per workspace, holds the workspace's end-users.
```

The third class is new. Workspace creation provisions the realm with:
- a built-in OIDC client `falcone-auth-users-spa` (public, PKCE, redirect URIs include
  `https://*.{publicHost}` and the tenant-configured ones),
- the `anon`, `authenticated` roles (which the data API ([[add-auto-rest-data-api]])
  maps to Postgres roles),
- no users; users are created on first sign-in.

Per-provider identity-provider configuration is layered on top via Keycloak's admin API,
abstracted by `services/keycloak-config/identity-providers/` so tenant operators never
touch Keycloak directly.

## OTP design

```
POST /v1/auth/users/otp { channel: "email"|"sms", recipient }
  → server generates 6-digit code, stores hash + recipient + workspace_id +
    expires_at(5min) + attempts_remaining(5) in `auth_otp_challenges`.
  → sends via messaging service ([[add-transactional-messaging]]).
  → returns { challengeId, expiresAt }.
POST /v1/auth/users/otp/verify { challengeId, code }
  → constant-time compare; on success, decrement attempts to -1 (consumed), mint session.
  → on failure, decrement attempts; at 0 mark challenge dead.
  → returns the session envelope on success, 401 with attemptsRemaining on failure.
```

Hash is `sha256(workspace_id || ":" || code || ":" || challenge_id)` — fast enough at
verify time, salted enough by `challenge_id` that a database leak doesn't enable rainbow
attack.

## Magic-link design

```
POST /v1/auth/users/magic-link { email, redirectTo }
  → mint single-use token (256-bit), store hash in `auth_magic_link_challenges` with
    expires_at(10min), recipient_email, requested_redirect_to.
  → send email with link
    `${publicAuthHost}/v1/auth/users/magic-link/verify?token=<token>&workspace=<wsId>`.
  → return 202.
GET  /v1/auth/users/magic-link/verify?token=...
  → validate, mint session, redirect to redirectTo with #access_token=... or
    ?code=... depending on flow.
```

Email-existence leak guard: the `POST` always returns 202 regardless of whether the
recipient exists in the tenant realm, mirroring REQ-IAM-03.

## OAuth provider abstraction

Provider catalog is JSON, shipped with the platform:

```jsonc
{
  "google": {
    "authorizeUrl": "https://accounts.google.com/o/oauth2/v2/auth",
    "tokenUrl":     "https://oauth2.googleapis.com/token",
    "userinfoUrl":  "https://openidconnect.googleapis.com/v1/userinfo",
    "scopesDefault": ["openid","email","profile"],
    "returnsEmailVerified": true,
    "returnsRefreshToken": "requires-prompt=consent&access_type=offline"
  }
}
```

This lets the platform support a long tail of providers without per-provider code; the
flow is uniform OIDC + a thin per-provider claims mapper.

## Anonymous (guest) sessions

```
POST /v1/auth/users/anonymous
  → if workspace.auth.providers.anonymous.enabled === false, return 404.
  → mint user with sub=anon-{uuid}, role=anonymous, no email, no provider, no recovery.
  → return session.
```

Anonymous users count against the per-workspace user quota; their cleanup is governed by
`plan.auth.anonymous_user_ttl_hours` (default 720 = 30 days). Cleanup runs as a
[[scheduling-engine]] job.

## CAPTCHA gating

Configurable per provider:

```yaml
auth.providers.email-otp:
  captcha:
    required: true
    providers: [turnstile, hcaptcha]
    minScore: 0.5   # for reCAPTCHA v3
```

The verification call hits the provider's server-side verify endpoint with a 2 s timeout
and fails closed (request denied) on timeout.

## Decision: one route family or split

| Option | Pros | Cons |
| --- | --- | --- |
| **A. Extend `auth.openapi.json`** | Single family for "auth". | The file already holds operator login; mixing in end-user flows muddies it. |
| **B. New `auth-end-users.openapi.json`** | Clear separation of operator vs. end-user. | One more family file. |

**Recommendation: B.** Operator auth and end-user auth have different audiences,
different rate-limit shapes, and different audit surfaces; keeping them separate makes
the surface area easier to reason about and easier to gate independently in APISIX.

## Decision: identity store

Keycloak per-workspace realm vs. a Falcone-native end-user table.

| Option | Pros | Cons |
| --- | --- | --- |
| **A. Keycloak realm per workspace** | Reuses the IdP we already operate; gets refresh tokens, token introspection, RBAC for free. | A realm per workspace scales to tens of thousands; we need to monitor Keycloak DB growth. |
| **B. Native users table** | Less infra; we control everything. | Re-implements password hashing, MFA, refresh tokens, OIDC. Years of work. |

**Recommendation: A.** Falcone already runs Keycloak; the per-realm model is the
industry-standard pattern (Auth0 tenants, AWS Cognito user pools, etc.). The scaling
concern is real but bounded: Keycloak has supported 10k+ realms in production
deployments. Mitigation: pre-warm common realms; archive realms whose workspaces have
been suspended.

## Open questions

- **Q-AUTH-01.** Should magic-link tokens be JWTs (so the verify endpoint is stateless)
  or opaque (so revocation is trivial)? Lean **opaque** — the volume is low, the
  revocation story is cleaner, and we already have Postgres in the hot path.
- **Q-AUTH-02.** Should we expose token introspection (`POST /v1/auth/users/introspect`)
  for server-side token validation? Lean **yes** — needed by tenant backends that don't
  want to depend on JWKS rotation timing.
- **Q-AUTH-03.** Per-workspace JWT signing keys vs. per-realm? Per-realm is cheaper
  (one JWKS to rotate per realm); per-workspace is more isolated. Since realm-per-workspace
  is the recommendation, per-realm = per-workspace. **Resolved by Q-AUTH design.**
