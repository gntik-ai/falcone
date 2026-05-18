# add-passwordless-and-social-auth

## Why

Every consumer-facing BaaS lets the developer offer their end-users **magic links,
email OTPs, SMS OTPs, and "Login with Google/Apple/GitHub/…"** through a single
documented API. Supabase, Firebase, Appwrite, and Auth0/Clerk all converge on the same
shape: `POST /auth/otp { email }`, `POST /auth/verify { token }`, `GET /auth/authorize/{provider}`.

Falcone has Keycloak under the hood ([[identity-and-access]]) — which technically
supports all of these — but the platform exposes **none of them as first-class
`/v1/auth/*` operations.** The current `/v1/auth/login-sessions` surface is only the
console-operator password flow. A tenant who wants their end-users to sign in with a
magic link must:

1. Stand up their own Keycloak realm-config glue, or
2. Stand up a custom service on top of Keycloak's admin API, or
3. Use a third-party auth provider — defeating the point of choosing Falcone.

This proposal exposes the four most-requested end-user auth flows as documented
platform endpoints so the JavaScript / mobile SDK can call them with a `publishable`
API key ([[add-tenant-api-keys]]) and a few headers, and the tenant gets a working
sign-in screen in an afternoon.

## What Changes

1. **New end-user auth endpoints under `/v1/auth/users/...`** (separate from the existing
   `/v1/auth/login-sessions` operator path):
   - `POST /v1/auth/users/magic-link` — body `{ email, redirectTo?, captchaToken? }`;
     sends a one-time login link via [[add-transactional-messaging]]; returns 202.
   - `POST /v1/auth/users/otp` — body `{ channel: "email"|"sms", recipient, captchaToken? }`;
     sends a 6-digit OTP; returns 202 + `{ challengeId, expiresAt }`.
   - `POST /v1/auth/users/otp/verify` — body `{ challengeId, code }`;
     returns the session envelope on success.
   - `POST /v1/auth/users/oauth/authorize` — body `{ provider, redirectTo,
     scopes?, captchaToken? }`; returns `{ authorizeUrl, state }`.
   - `GET  /v1/auth/users/oauth/callback` — provider redirect target; exchanges
     code, mints session, redirects to `redirectTo`.
   - `POST /v1/auth/users/sessions/refresh` — refresh the end-user session
     (separate from operator session refresh).
   - `DELETE /v1/auth/users/sessions/{sessionId}` — sign out.
   - `GET  /v1/auth/users/me` — return the current end-user profile (decoded JWT
     claims + any custom claims).
   - `POST /v1/auth/users/anonymous` — mint a guest session (opt-in per workspace);
     returns a session envelope with `role=anonymous`.
2. **Per-workspace auth provider configuration:**
   - `GET|PUT /v1/iam/workspaces/{workspaceId}/auth/providers/{provider}` —
     `provider ∈ {google, apple, github, gitlab, microsoft, facebook, twitter,
     linkedin, discord, slack, magic-link, email-otp, sms-otp, anonymous}`;
     body holds `{ enabled, clientId, clientSecret, scopes, redirectUris[],
     domainAllowlist[]?, autoCreateUsers }`.
   - `GET  /v1/iam/workspaces/{workspaceId}/auth/providers` — list current config.
   - `GET  /v1/iam/workspaces/{workspaceId}/auth/providers/catalog` — provider
     catalog with capability hints (does it return email-verified? does it return
     a refresh token? etc.).
3. **End-user identity model:** A per-workspace Keycloak realm holds end-users.
   The platform automatically creates the realm at workspace creation and provisions
   the configured providers as identity-providers on that realm. The `/v1/auth/users/*`
   endpoints proxy to the tenant realm; tokens issued are RS256 JWTs whose `sub` is
   the end-user UUID and whose `aud` is the workspace.
4. **Webhooks for end-user lifecycle** (consumed by [[realtime-and-events]] F3):
   `auth.user.signed_up`, `auth.user.signed_in`, `auth.user.signed_out`,
   `auth.user.password_recovered`, `auth.user.email_verified`,
   `auth.user.provider_linked`, `auth.user.deleted`.
5. **CAPTCHA / abuse controls.** Optional Turnstile / hCaptcha / reCAPTCHA token
   verification on `/v1/auth/users/magic-link`, `/otp`, `/oauth/authorize`, and
   `/anonymous`. Per-IP and per-email rate limits at the gateway.
6. **`ConsoleAuthProvidersPage`** — UI to enable/configure providers per workspace,
   with per-provider setup wizards (e.g. OAuth client id/secret with copy-paste
   redirect URI hint).

## Impact

- **Affected specs**:
  - `openspec/specs/identity-and-access/spec.md` — adds REQs for `/v1/auth/users/...`,
    per-workspace provider configuration, end-user lifecycle event taxonomy.
- **Affected code**:
  - `apps/control-plane/openapi/families/auth.openapi.json` — gains the `/v1/auth/users/*`
    operation set; or split out into `auth-end-users.openapi.json` (decision in
    [[design.md]]).
  - `services/keycloak-config/` — promoted from "scope manifests only" (per
    `CAPABILITY-CATALOG.md` Q-IAM-01) to runtime owner of:
    - end-user realm provisioning,
    - per-provider identity-provider wiring,
    - the auth-users facade.
  - `services/internal-contracts/src/auth-user-{request,result,lifecycle-event}-v1.json`.
  - `services/gateway-config/routes/auth-users.yaml` — wires per-IP and per-email
    rate-limit plugins; integrates the [[add-tenant-api-keys]] `tenant-api-key` plugin
    so `apikey: sbp_*` is the authentication of the auth call itself.
  - `apps/web-console/src/pages/ConsoleAuthProvidersPage.tsx`.
- **Dependencies**:
  - **Hard:** [[add-tenant-api-keys]] — the auth endpoints must be callable from a
    browser with a `publishable` key.
  - **Hard:** [[add-transactional-messaging]] — required to send magic links and email
    OTPs. SMS OTPs additionally require the SMS adapter in the same proposal.
- **No breaking changes** — `/v1/auth/login-sessions` (operator session) is untouched;
  the new surface is parallel.
