# Tasks — add-passwordless-and-social-auth

- [ ] **T01** Confirm baseline green.
- [ ] **T02** Author `apps/control-plane/openapi/families/auth-end-users.openapi.json`
      with all `/v1/auth/users/*` operations.
- [ ] **T03** Extend `apps/control-plane/openapi/families/iam.openapi.json` with
      `/v1/iam/workspaces/{workspaceId}/auth/providers*` CRUD and the provider catalog.
- [ ] **T04** Promote `services/keycloak-config/` to a runtime service that owns:
      per-workspace realm provisioning, identity-provider configuration, and the
      end-user auth facade. Decision: extract to `services/auth-end-users/` or keep in
      `services/keycloak-config/` — confirm in PR.
- [ ] **T05** Migration `services/provisioning-orchestrator/src/migrations/NNN-auth-otp.sql`
      creating `auth_otp_challenges` and `auth_magic_link_challenges`.
- [ ] **T06** Implement OTP issue + verify + magic-link issue + verify with constant-time
      compares, attempt counters, expiry, audit.
- [ ] **T07** Implement OAuth provider catalog loader + generic OIDC client + 10+ provider
      configs (google, apple, github, gitlab, microsoft, facebook, twitter, linkedin,
      discord, slack).
- [ ] **T08** Implement anonymous sessions + cleanup job in [[scheduling-engine]].
- [ ] **T09** Implement CAPTCHA verification middleware (turnstile, hcaptcha, reCAPTCHA v3).
- [ ] **T10** Emit `auth.user.*` lifecycle events to Kafka and register them in the
      webhook engine event-types catalog.
- [ ] **T11** Wire APISIX routes with per-IP and per-email rate limits;
      `tenant-api-key` plugin from [[add-tenant-api-keys]] is the authentication of
      auth-API calls.
- [ ] **T12** Console page `ConsoleAuthProvidersPage.tsx` with per-provider wizard
      (copy-paste-ready redirect URI, secret reveal-once, test-config button).
- [ ] **T13** Contract tests: OTP attempt-exhaustion, magic-link single-use, OAuth
      state parameter binding, per-workspace token isolation, CAPTCHA timeout fail-closed.
- [ ] **T14** Run `openspec validate --strict` and re-run baseline validators.
