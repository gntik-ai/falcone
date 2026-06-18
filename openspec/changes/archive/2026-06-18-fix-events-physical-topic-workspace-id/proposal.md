# fix-events-physical-topic-workspace-id

## Change type
bugfix

## Capability
events

## Priority
P1

## Why
The control-plane events path names the physical topic `ws.${ws.slug}.${topic}`; slugs are not globally unique, so two tenants' same-slug workspaces + same topic name collide on one physical topic + one store record, and the second tenant is locked out (404). The executor path correctly uses `evt.<workspaceId>.<topic>`.

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** acme & globex each POST `{name:collide-events}` to their `app-staging` ws -> identical `res_topic_80c2db4e` + identical physical `ws.app-staging.collide-events`; Kafka shows ONE such topic; globex then 404s on its own topic. `deploy/kind/control-plane/kafka-handlers.mjs:90`.

GitHub epic B. Evidence: `audit/live-campaign/evidence-rerun/EVENTS-isolation.md`.

## What Changes
Derive the control-plane physical name from the unique workspace id (align with `events-executor.mjs`); key `workspace_topics` by `(workspace_id, topic_name)`.

## Impact
Two same-slug workspaces across tenants get distinct physical topics + distinct resourceIds; both tenants can use their topic; JWT and apiKey paths resolve to the same physical topic.
