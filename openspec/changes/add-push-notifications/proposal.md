# add-push-notifications

## Why

FCM-style push notifications are Firebase's most-copied feature: every modern mobile and
PWA application needs them. Supabase has FCM in private beta; Appwrite ships a first-class
push channel; Firebase *is* FCM for most product teams. Falcone offers none of this.

This proposal extends the new [[add-transactional-messaging]] capability with three more
channels — **FCM (Android + iOS via FCM bridge), APNs (direct), and Web Push (VAPID)** —
plus the missing primitive that email/SMS don't need: **device-token registration**. A
mobile or web client registers its push token via the public API key surface, then any
authorised server-side caller can send notifications to a user, a device, a tag, or a
topic.

The leverage is high because:
1. The transactional-messaging proposal already builds the queue, adapter abstraction,
   provider configuration UI, suppression list, idempotency, and quota machinery —
   push reuses ~80 % of it.
2. The only fundamentally-new concept is **device tokens** (one extra table).
3. Without push, Falcone is unviable for mobile-first applications, which is the
   majority of new product builds.

## What Changes

1. **Channels added** to the `messaging` capability:
   - `push.fcm` — Firebase Cloud Messaging (Android + iOS via the FCM/APNs bridge).
   - `push.apns` — direct Apple Push Notification service with token-based auth (.p8).
   - `push.web` — Web Push with VAPID keys.
2. **Send endpoints (workspace-scoped, follow the messaging shape):**
   - `POST /v1/messaging/workspaces/{workspaceId}/push/send` —
     `{ target: { kind: "device"|"user"|"topic"|"tag", value: string|string[] },
        notification: { title, body, imageUrl?, clickAction?, sound?, badge? },
        data?: { [string]: string },
        priority?: "normal"|"high",
        ttlSeconds?: number,
        collapseKey?: string,
        platformOverrides?: { android?, apns?, web? } }`
     → returns `{ messageId, fanoutCount, status, provider }`.
3. **Device-token registration (callable by `publishable` API keys):**
   - `POST   /v1/messaging/workspaces/{workspaceId}/push/devices` —
     `{ platform: "ios"|"android"|"web", token, userId?, locale?, timezone?,
        appVersion?, osVersion?, deviceModel?, tags[]? }`
     → returns `{ deviceId }`; idempotent on `(workspaceId, platform, token)`.
   - `DELETE /v1/messaging/workspaces/{workspaceId}/push/devices/{deviceId}` — unregister.
   - `PATCH  /v1/messaging/workspaces/{workspaceId}/push/devices/{deviceId}` — update
     userId, tags, locale.
   - `GET    /v1/messaging/workspaces/{workspaceId}/push/devices` — list (admin scope);
     filters by `userId, tag, platform, lastSeenAfter`.
4. **Topic subscription:**
   - `POST   /v1/messaging/workspaces/{workspaceId}/push/devices/{deviceId}/subscriptions/{topic}` — subscribe.
   - `DELETE` of same — unsubscribe.
   - `POST   /v1/messaging/workspaces/{workspaceId}/push/topics/{topic}/broadcasts` —
     fan-out broadcast (subject to plan).
5. **Provider configuration (extends REQ-MSG-02 schema):**
   - `kind ∈ {fcm, apns, webpush}`. Credentials per kind:
     - `fcm`: service-account JSON.
     - `apns`: `.p8` key + key id + team id + bundle id; environment
       (`sandbox|production`).
     - `webpush`: VAPID public + private + subject (mailto).
6. **Delivery events** (extend REQ-MSG-04 taxonomy):
   - `messaging.push.token.invalid` — provider says the token is dead → suppression.
   - `messaging.push.delivered`, `messaging.push.failed`,
     `messaging.push.fanout_completed`.
7. **Token health & rotation:**
   - Tokens are heartbeated on each `POST .../push/devices` re-registration; idle
     beyond `plan.messaging.push.token_ttl_days` (default 180) are GC'd.
   - Invalid-token events from providers auto-evict the token; the next legitimate
     re-register reactivates.
8. **Console:** the `ConsoleMessagingPage` Activity tab gains a Push subtab; the
   Providers tab gains FCM/APNs/Web Push setup wizards.

## Impact

- **Affected specs**:
  - `openspec/specs/messaging/spec.md` — adds REQs for push channels, device
    registration, topic fan-out, and token lifecycle. (Created by
    [[add-transactional-messaging]]; this proposal lands as a delta on top.)
- **Affected code**:
  - `services/messaging-engine/src/adapters/push/` — `fcm.mjs`, `apns.mjs`, `webpush.mjs`.
  - `services/messaging-engine/src/devices/` — registration, indexing, GC.
  - `services/messaging-engine/src/topics/` — subscription, fan-out planner.
  - Migration `NNN-messaging-push.sql` — `messaging_push_devices,
    messaging_push_device_tags, messaging_push_topic_subscriptions`.
  - `apps/control-plane/openapi/families/messaging.openapi.json` — push operations.
  - `services/internal-contracts/src/messaging-push-{device,target,event}-v1.json`.
  - `apps/web-console/src/pages/ConsoleMessagingPage.tsx` — Push subtab + wizards.
- **Dependencies (hard)**:
  - [[add-transactional-messaging]] — the messaging capability and infrastructure.
  - [[add-tenant-api-keys]] — `publishable` key needed for device registration from
    mobile/browser clients.
- **No breaking changes** — additive within the messaging capability.
