# Tasks — fix-events-physical-topic-workspace-id

## Reproduce (test-first)
- [x] `tests/blackbox/events-physical-topic-workspace-id.test.mjs` — fails on the old code: the `physicalTopicName` export is absent and `insertTopic` keys `ON CONFLICT (physical_topic_name)`, hijacking the first tenant's row.

## Implement (kind runtime AND shippable product as applicable)
- [x] `kafka-handlers.mjs`: new exported `physicalTopicName(workspaceId, topic)` → `evt.<workspaceId>.<topic>` (executor-aligned); `eventsProvisionTopic` uses it; inventory `namingPolicy.topicPrefix` → `evt.`.
- [x] `tenant-store.mjs::insertTopic`: key `ON CONFLICT (workspace_id, topic_name)` (was `physical_topic_name`); never reassign `tenant_id`.

## Verify
- [x] `node --test tests/blackbox/events-physical-topic-workspace-id.test.mjs` green; existing events tests (`events-topic-tenant-scope`, `events-cross-tenant-publish`) unaffected.
- [x] Acceptance: two same-slug workspaces across tenants get distinct physical topics + distinct resourceIds; re-provision is idempotent; JWT and apiKey paths resolve to the same `evt.<ws>.<topic>` physical topic.

## Archive
- [ ] `openspec validate fix-events-physical-topic-workspace-id --strict`; `/opsx:archive fix-events-physical-topic-workspace-id` after merge.
