# Design — add-transactional-messaging

## Goals

1. A tenant pastes SES credentials, hits "send test", receives a real email within
   seconds.
2. The same API powers both tenant-issued ("your order shipped") and
   platform-issued ("your magic link") messages, so [[add-passwordless-and-social-auth]]
   has no second integration to wire.
3. Delivery reliability is a first-class concern: retries, suppression, bounce/complaint
   handling out of the box.
4. Adapter pattern stays uniform with [[storage-adapter]] G1 — adding Postmark next
   month is ~150 LoC.

## Non-goals

- **Marketing-grade segmentation, drip campaigns, A/B testing.** Out of scope —
  transactional only. A future `add-marketing-messaging` proposal could layer this on.
- **In-app messaging / chat.** Different paradigm; out of scope.
- **Push notifications.** Tracked separately as [[add-push-notifications]] for clarity,
  even though they extend this capability.

## Architecture

```
caller → /v1/messaging/.../send
         → gateway → messaging-engine API
                     ├── validate body, lookup template version
                     ├── consult suppression list (silent drop if hit)
                     ├── INSERT messaging_messages (status=queued)
                     ├── enqueue on Kafka topic console.messaging.outbound
                     └── 202 { messageId, status: "queued" }
console.messaging.outbound
         → messaging-engine worker (consumer group, 1 partition per workspace)
                     ├── load provider for (workspace, channel)
                     ├── render template
                     ├── adapter.send()
                     ├── UPDATE messaging_messages (status=sent|failed)
                     └── emit messaging.message.{sent|failed}
provider webhook (SES/SendGrid/Twilio) → /v1/messaging/inbound/{provider}
         → verify signature
         → translate to canonical delivery event
         → emit messaging.message.{delivered|bounced|complained|opened|clicked}
         → if bounce.permanent || complaint → add to suppression list
```

Send is asynchronous to keep the hot path fast and to give us retry, rate-limit, and
provider-fallback policies in one place. Synchronous send is available via
`Prefer: respond-async=false` for callers that need the result inline (sub-300ms p99
target for adapters with synchronous APIs).

## Provider abstraction

```js
// services/messaging-engine/src/adapters/email/_interface.mjs
export class EmailAdapter {
  async send({ to, from, subject, html, text, headers, attachments, idempotencyKey })
  async cancel({ providerMessageId })       // optional; throws NotSupported
  parseInboundWebhook(req)                  // returns canonical DeliveryEvent[] | null
}
```

Concrete adapters:
- `smtp` — Node.js `nodemailer` over arbitrary SMTP. No webhook support — bounces
  come back as failed SMTP responses synchronously.
- `aws-ses` — AWS SDK + SNS subscription for events.
- `postmark` / `sendgrid` / `mailgun` / `resend` — REST + provider webhooks.

SMS uses an analogous `SmsAdapter` with `twilio, vonage, aws-sns, messagebird`.

## Templating

Three formats supported, chosen per template:

- **MJML** — compiled at template publish time to responsive HTML; the source MJML
  is preserved for re-edit, but renders use the compiled HTML.
- **HTML** — raw HTML with Handlebars `{{var}}` substitution.
- **Plaintext** — Handlebars only.

Variable escaping is on by default; `{{{ rawVar }}}` is opt-in and lints flag it in
the console. Subjects are always plaintext + Handlebars; HTML in subject is rejected.

Localisation: a template `slug` can have multiple `locale` rows; sends pick the locale
nearest to the requested one (BCP-47), falling back to the template's default.

Version pinning: each template publish bumps `version` (monotonic per slug). Sends may
pin `{ templateId, version }`; otherwise the latest version is used.

## Suppression list

```sql
CREATE TABLE messaging_suppressions (
  workspace_id     uuid NOT NULL,
  channel          text NOT NULL CHECK (channel IN ('email','sms')),
  address_hash     text NOT NULL,      -- sha256(lower(address))
  address_redacted text NOT NULL,      -- "a***@example.com" for UI
  reason           text NOT NULL,      -- bounce_hard | complaint | unsubscribe | manual
  source_provider  text,
  added_at         timestamptz NOT NULL,
  expires_at       timestamptz,        -- NULL = permanent
  PRIMARY KEY (workspace_id, channel, address_hash)
);
```

Sends check the suppression list before queueing; suppressed recipients are dropped
with `status=suppressed` and emit `messaging.message.suppressed`. The list is
authoritative across providers — a hard bounce on SES suppresses the address on
SendGrid too.

## Idempotency

`Idempotency-Key: <opaque>` header on send requests. Stored for 24 h in
`messaging_idempotency_keys (workspace_id, key, message_id)`. Duplicate within the
window returns the original `messageId` and HTTP 200 with `Falcone-Idempotent-Replay: true`.

## Provider rotation

Each channel can have multiple providers; one is `isDefault`. Sends may target a
specific provider via `?provider=<slug>`; otherwise the default is used. If the default
fails with a `provider_transient_failure`, the engine attempts the next-priority
provider for the same channel (configurable per workspace).

## Plan dimensions

```
messaging.email.send.per_day                 # daily cap
messaging.email.send.rate.per_minute         # burst control
messaging.sms.send.per_day
messaging.sms.send.rate.per_minute
messaging.templates.max                      # templates count
messaging.providers.per_channel.max          # providers per channel
messaging.suppressions.max                   # suppression list size
messaging.message_retention_days             # default 90, max 365
```

Default ladder: starter (200/day), growth (10k/day), enterprise (unmetered + dedicated IP).

## Decision: new service vs. extend an existing one

| Option | Pros | Cons |
| --- | --- | --- |
| **A. New `services/messaging-engine/`** | Clear bounded context, mirrors `webhook-engine`. | Yet another service. |
| **B. Extend `services/webhook-engine/`** | Already has retry/queue infrastructure. | Different egress shape (templated content vs. raw payload); semantics drift hurts both. |

**Recommendation: A.** The semantic distance is large enough that conflating them
hurts both surfaces. Reuse code patterns (retry, queue, idempotency) but not the
service.

## Decision: where do inbound provider webhooks land

The gateway exposes `/v1/messaging/inbound/{provider}` as **public** routes with no
auth header — they are authenticated by HMAC signature against
`provider.webhookSigningSecret`. This is the same pattern Stripe/SendGrid/etc. expect
and avoids the "tenants can't configure auth headers on third-party dashboards"
problem.

## Open questions

- **Q-MSG-01.** Do we support tenant-supplied SMTP as an "adapter" or refuse and
  require a managed provider? Lean **support it** for self-hosted parity with
  Pocketbase / Appwrite.
- **Q-MSG-02.** Open and click tracking — opt-in per template, opt-in per send, or
  both? Lean **both**; per-send wins when set.
- **Q-MSG-03.** Should the engine handle outbound queueing in Postgres (LISTEN/NOTIFY
  or `SELECT ... FOR UPDATE SKIP LOCKED`) or Kafka? Lean **Kafka** — Falcone already
  operates Kafka, ordering per partition matches per-workspace fairness needs, and
  worker scale-out is trivial.
- **Q-MSG-04.** Attachment size cap? Lean **25 MiB per attachment, 40 MiB per message**,
  with spillover to S3 + presigned URL (mirrors webhook engine F3 payload spillover).
