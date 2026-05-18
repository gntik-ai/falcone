# Tasks — add-push-notifications

- [ ] **T01** Confirm baseline green; confirm [[add-transactional-messaging]] has landed
      (this proposal depends on the messaging engine).
- [ ] **T02** Extend `apps/control-plane/openapi/families/messaging.openapi.json` with
      push send + device + topic operations.
- [ ] **T03** Implement push adapter interface and `fcm.mjs`, `apns.mjs`, `webpush.mjs`
      under `services/messaging-engine/src/adapters/push/`.
- [ ] **T04** Migration `NNN-messaging-push.sql`
      (`messaging_push_devices`, `messaging_push_device_tags`,
       `messaging_push_topic_subscriptions`).
- [ ] **T05** Implement device registration + idempotency + token-hash dedupe.
- [ ] **T06** Implement topic subscription management.
- [ ] **T07** Implement fan-out planner with batch streaming and progress events.
- [ ] **T08** Wire token-invalidation handling into adapter error normalisation.
- [ ] **T09** Add daily device-GC job in [[scheduling-engine]].
- [ ] **T10** Encrypt tokens at rest via Vault transit engine ([[secret-management]]).
- [ ] **T11** Add plan dimensions per [[design.md]] to [[quota-and-billing]] catalog.
- [ ] **T12** Console `ConsoleMessagingPage` Push subtab + FCM/APNs/Web Push wizards.
- [ ] **T13** Contract tests: device idempotency, user fan-out, token-invalid eviction
      and reactivation, topic fan-out > 10k devices, per-platform overrides.
- [ ] **T14** Run `openspec validate --strict` and re-run baseline validators.
