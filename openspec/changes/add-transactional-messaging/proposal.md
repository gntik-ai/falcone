# add-transactional-messaging

## Why

The audit shows Falcone has **no email and no SMS messaging capability whatsoever.** The
closest thing is the webhook engine (F3), which is event egress to *URLs the tenant
controls* — not a way to send a password-reset email or a "your order shipped" SMS.

Every commercial BaaS provides transactional messaging:

- Supabase ships SMTP + Twilio integrations and exposes them via the Auth API.
- Firebase ships FCM and email-template stubs through Cloud Functions + SendGrid.
- Appwrite ships a first-class Messaging service with email/SMS/push channels and
  templates.

Three downstream features Falcone needs **all require** transactional messaging:
- magic links and email OTP ([[add-passwordless-and-social-auth]]),
- SMS OTP (same),
- platform-issued notifications (signup approval, suspension warnings, backup-failure
  alerts).

Without messaging, `add-passwordless-and-social-auth` cannot ship; with it, the platform
becomes self-contained for the entire end-user lifecycle.

This proposal introduces a **new capability `messaging` (prefix `MSG`)** that owns email
and SMS today and is extended by [[add-push-notifications]] tomorrow.

## What Changes

1. **New capability `messaging` (prefix `MSG`)** added to
   `openspec/CAPABILITY-CATALOG.md`. Owns:
   - route family `/v1/messaging/...` (`apps/control-plane/openapi/families/messaging.openapi.json`),
   - the new service `services/messaging-engine/`,
   - the relevant slice of `services/internal-contracts/`.
2. **Channels and adapters.**
   - Email: SMTP (RFC 5321), AWS SES, Postmark, SendGrid, Mailgun, Resend. Adapter
     pattern mirrors [[storage-adapter]] G1.
   - SMS: Twilio, Vonage, AWS SNS, MessageBird. Same adapter pattern.
   - Push: deferred to [[add-push-notifications]].
3. **Endpoints (workspace-scoped):**
   - `POST  /v1/messaging/workspaces/{workspaceId}/email/send` —
     `{ to[], from?, subject, body: { text?, html?, templateId?, templateData? },
        replyTo?, attachments[]?, headers?{}, tags[]? }`
     → returns `{ messageId, status, provider }`.
   - `POST  /v1/messaging/workspaces/{workspaceId}/sms/send` —
     `{ to, from?, body, templateId?, templateData?, tags[]? }`.
   - `GET   /v1/messaging/workspaces/{workspaceId}/messages/{messageId}` — single
     message + delivery events.
   - `GET   /v1/messaging/workspaces/{workspaceId}/messages` — list with filters
     `?channel=&status=&since=&until=&recipient=&tag=`.
   - `POST  /v1/messaging/workspaces/{workspaceId}/messages/{messageId}/cancel` —
     cancel a queued (not-yet-sent) message.
4. **Provider configuration (per workspace):**
   - `GET|PUT|DELETE /v1/messaging/workspaces/{workspaceId}/providers/{channel}/{slug}` —
     `{ enabled, kind, credentials, defaultFromAddress, defaultFromName, sandboxMode,
        webhookSigningSecret? }`. Multiple providers per channel allowed; one is the
     default.
   - `POST  /v1/messaging/workspaces/{workspaceId}/providers/{channel}/{slug}/test` —
     send a synthetic message to verify credentials.
5. **Templates with versioning:**
   - `POST|GET|PATCH|DELETE /v1/messaging/workspaces/{workspaceId}/templates/{slug}` —
     `{ channel, subject?, body, format: "mjml"|"html"|"plaintext", locale,
        variables[]: { name, type, required } }`.
   - `POST .../templates/{slug}/render` — preview rendered output with sample data.
   - Versioned by content hash; sends reference `{ templateId, version? }`.
6. **Delivery webhooks back to tenants** (events emitted on Kafka,
   delivered via [[realtime-and-events]] F3 webhook engine):
   - `messaging.message.queued`, `messaging.message.sent`,
     `messaging.message.delivered`, `messaging.message.bounced`,
     `messaging.message.complained`, `messaging.message.opened`,
     `messaging.message.clicked`, `messaging.message.failed`.
7. **Suppression list per workspace:** addresses that hard-bounce, complain, or
   unsubscribe are added to a per-workspace suppression list and silently dropped at
   send time. `GET|POST|DELETE /v1/messaging/workspaces/{workspaceId}/suppressions/{address}`.
8. **Quotas, throttling, sandbox mode:**
   - Plan dimensions: `messaging.email.send.per_day`, `messaging.sms.send.per_day`,
     `messaging.email.send.rate.per_minute`, `messaging.sms.send.rate.per_minute`,
     `messaging.templates.max`, `messaging.providers.per_channel.max`.
   - Sandbox mode: when enabled on a provider, messages are accepted but not delivered;
     stored for inspection in `messaging_sandbox_messages` for ≤ 7 days.
9. **`ConsoleMessagingPage`** with three tabs: Providers, Templates, Activity.

## Impact

- **Affected specs**:
  - `openspec/CAPABILITY-CATALOG.md` — new capability row for `messaging` (prefix MSG).
  - `openspec/specs/messaging/spec.md` — new file (this proposal creates the capability;
    the delta below adds the initial REQs).
  - `openspec/specs/realtime-and-events/spec.md` — adds the messaging event types to
    the webhook engine catalog (cross-capability dep; tracked here, applied in that
    capability's next spec round).
  - `openspec/specs/quota-and-billing/spec.md` — adds the new plan dimensions
    (cross-capability dep; same).
- **Affected code**:
  - `services/messaging-engine/` (new) — adapters, queue worker, suppression list,
    templates renderer (MJML / handlebars), delivery webhook receiver.
  - `apps/control-plane/openapi/families/messaging.openapi.json` (new).
  - `services/internal-contracts/src/messaging-{request,result,event,template,
    provider}-v1.json` (new).
  - `services/provisioning-orchestrator/src/migrations/NNN-messaging.sql` —
    `messaging_providers, messaging_templates, messaging_messages,
    messaging_delivery_events, messaging_suppressions, messaging_sandbox_messages`.
  - `services/gateway-config/routes/messaging.yaml` — routes + provider-callback inbound
    routes (for SES, SendGrid, Twilio webhooks).
  - `apps/web-console/src/pages/ConsoleMessagingPage.tsx`.
- **Dependencies**:
  - [[add-tenant-api-keys]] — for `service_role` callable from tenant backends.
- **Consumers**:
  - [[add-passwordless-and-social-auth]] — magic link, email OTP, SMS OTP.
  - Existing self-service signup ([[identity-and-access]] REQ-IAM-02 approval-required
    flow) — emits "approval pending" notifications.
  - Backup notifications ([[backup-and-restore]] L1) — "backup failed" alerts.
- **No breaking changes** — additive new surface.
