# Design — add-push-notifications

## Goals

1. A React Native or Flutter app calls `client.push.registerDevice({ token, userId })`
   once, and any server can then send a notification to that user with one API call.
2. Token rot is invisible to the app developer: dead tokens are auto-evicted and
   reactivated on next registration.
3. Sending to a `user` (logical) is as easy as sending to a `device` (physical), so
   notifications follow the user across phone replacements without app logic.
4. Topic fan-out scales: a "global announcement" send completes async with
   `fanoutCount` and progress events; the tenant doesn't have to chunk.

## Non-goals

- **In-app notification centre / inbox.** A separate `add-notification-inbox` proposal.
- **Rich notifications authoring UI** (image picker, action button designer). A
  follow-up.
- **Localised notification content.** Reuse template + locale model from REQ-MSG-03;
  no new mechanism.

## Targeting model

```
target.kind = "device"  → value: deviceId | deviceId[]
target.kind = "user"    → value: userId   | userId[]   (fan out to all that user's active devices)
target.kind = "topic"   → value: "<topic>" (single topic, fan out to all subscribers)
target.kind = "tag"     → value: { all|any: ["tag1", "tag2", ...] }
```

A `user`-targeted send is equivalent to a multi-device send: the engine looks up active
devices for `(workspaceId, userId)` and fans out per platform. A `topic` send is the
same but via the subscription table.

Per-platform overrides live under `platformOverrides`:

```jsonc
{
  "android": { "channelId": "high-priority", "color": "#FF0000" },
  "apns":    { "interruptionLevel": "time-sensitive", "threadId": "order-123" },
  "web":     { "actions": [{ "action": "view", "title": "View" }] }
}
```

## Device table

```sql
CREATE TABLE messaging_push_devices (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL,
  workspace_id      uuid NOT NULL,
  platform          text NOT NULL CHECK (platform IN ('ios','android','web')),
  token             text NOT NULL,
  token_hash        text NOT NULL,            -- sha256(token) for cheap lookup
  user_id           text,                     -- end-user sub or app user id
  locale            text,
  timezone          text,
  app_version       text,
  os_version        text,
  device_model      text,
  status            text NOT NULL,            -- active|invalid|gc
  last_seen_at      timestamptz NOT NULL,
  created_at        timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL,
  UNIQUE (workspace_id, platform, token_hash)
);
CREATE INDEX ON messaging_push_devices (workspace_id, user_id) WHERE status = 'active';
CREATE INDEX ON messaging_push_devices (workspace_id, last_seen_at) WHERE status = 'active';
```

Tokens themselves are stored encrypted at rest via [[secret-management]] (Vault transit
engine) so a DB leak doesn't yield a stash of valid push tokens.

## Fan-out planner

For a `topic`/`user`/`tag` send, the engine:

1. Streams matching device rows in batches of 500.
2. For each batch, partitions by platform.
3. For FCM, uses the multicast send API (≤ 500 tokens per call).
4. For APNs, parallelises individual sends with HTTP/2 multiplexing (per-connection
   cap of 100 in flight).
5. For Web Push, parallelises with a global per-workspace concurrency cap.
6. Emits `messaging.push.fanout_progress` every 1000 devices and
   `messaging.push.fanout_completed` at the end with totals
   `{ attempted, succeeded, invalid, failed }`.

The whole fan-out is one `messageId`; per-device delivery rows are persisted in
`messaging_delivery_events` with `recipientHash = sha256(token)`.

## Token invalidation

When a provider returns `NotRegistered`, `Unregistered`, `InvalidRegistration`,
`MismatchSenderId`, `BadDeviceToken`, or HTTP 410 (Web Push), the engine marks the
device row `status=invalid` and emits `messaging.push.token.invalid`. The next
legitimate `POST .../push/devices` registration with the same `(workspace, platform,
token)` reactivates the row (so app reinstalls reactivate transparently).

A daily [[scheduling-engine]] job marks devices `status=gc` when
`last_seen_at < now() - plan.messaging.push.token_ttl_days` (default 180).

## VAPID for Web Push

Each workspace's Web Push provider holds a VAPID keypair. The browser SDK fetches
`GET /v1/messaging/workspaces/{workspaceId}/push/public-key` (the VAPID public key) at
subscription time. The private key never leaves Vault.

## APNs key management

APNs uses .p8 token-based auth (deprecating certificate auth). The provider config
stores `{ keyP8, keyId, teamId, bundleId, environment }`. The adapter mints JWTs valid
for 60 minutes and caches them; rotation is handled by [[secret-management]] when the
tenant updates the .p8.

## Plan dimensions (in addition to REQ-MSG-06)

```
messaging.push.devices.per_workspace.max
messaging.push.topics.per_workspace.max
messaging.push.subscriptions.per_device.max
messaging.push.fanout.targets_per_send.max
messaging.push.sends.per_day
messaging.push.sends.rate.per_minute
messaging.push.token_ttl_days
```

## Open questions

- **Q-PUSH-01.** Should `target.kind=user` automatically include "anonymous" devices
  (those registered without `userId`)? Lean **no** — anonymous devices must be
  targeted via `tag` or `device` to avoid accidental fan-out.
- **Q-PUSH-02.** Should we support **Live Activities** (iOS 16.1+) and **Web Push
  badge counts**? Lean **defer**; rich activity content fits a follow-up proposal.
- **Q-PUSH-03.** Cost of multi-region APNs sends — open one HTTP/2 connection per
  workspace per environment (sandbox/production) and reuse? Lean **yes**.
- **Q-PUSH-04.** Topic-name format — anything goes vs. enforce `[a-z0-9._-]{1,64}`?
  Lean **enforce**; mirrors Kafka topic naming and avoids surprise behaviour.
