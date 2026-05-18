# Tasks — add-transactional-messaging

- [ ] **T01** Confirm baseline green.
- [ ] **T02** Register new capability `messaging` (prefix `MSG`) in
      `openspec/CAPABILITY-CATALOG.md` and `openspec/conventions.md`.
- [ ] **T03** Author `apps/control-plane/openapi/families/messaging.openapi.json`
      (send, list, get, cancel, providers CRUD + test, templates CRUD + render,
      suppressions CRUD, inbound webhooks).
- [ ] **T04** Scaffold `services/messaging-engine/` (Node 20 ESM, pnpm workspace).
- [ ] **T05** Implement email adapter interface + SMTP, AWS SES, Postmark, SendGrid,
      Mailgun, Resend adapters.
- [ ] **T06** Implement SMS adapter interface + Twilio, Vonage, AWS SNS, MessageBird
      adapters.
- [ ] **T07** Migration `NNN-messaging.sql` (providers, templates, messages, delivery
      events, suppressions, idempotency keys, sandbox messages).
- [ ] **T08** Implement template renderer (MJML compile, Handlebars render, locale
      fallback, variable validation).
- [ ] **T09** Implement outbound worker (Kafka consumer) with retry, provider rotation,
      suppression check, idempotency.
- [ ] **T10** Implement inbound-webhook handlers per provider with HMAC signature
      verification; translate to canonical delivery events.
- [ ] **T11** Register `messaging.message.*` events in [[realtime-and-events]] webhook
      engine event-types catalog.
- [ ] **T12** Add plan dimensions to [[quota-and-billing]] plan catalog and enforce in
      orchestrator quota engine.
- [ ] **T13** Wire APISIX routes (`/v1/messaging/*` authenticated;
      `/v1/messaging/inbound/{provider}` public-by-design).
- [ ] **T14** Console `ConsoleMessagingPage.tsx` (Providers, Templates, Activity tabs).
- [ ] **T15** Contract tests: send → queue → adapter; bounce → suppression; idempotent
      replay; sandbox-mode no actual send; provider rotation on transient failure.
- [ ] **T16** Run `openspec validate --strict` and re-run baseline validators.
