# Events/Kafka isolation — re-run 2026-06-18 (cardinal investigation)

## What the prior P0 (ISO-EVENTS #547) fixed — HOLDS
`deploy/kind/control-plane/kafka-handlers.mjs::resolveTopic` now enforces the caller's verified tenant owns the
topic (cross-tenant resource id → 404, no existence leak). Empirically: `globex-ops GET {acme topicId}` → **404**;
`globex-ops` SSE on an acme topic id → **404**. The id-based IDOR data-leak is closed. ✓

## NEW / residual finding — FIND-EVENTS-SLUG-COLLISION (P1)
**Two divergent physical-topic naming schemes:**
- Control-plane (gateway **JWT** path) `kafka-handlers.mjs:90`: `physical = ws.${ws.slug}.${topicName}` — uses the
  workspace **slug**, which is **NOT globally unique**.
- Executor (**apiKey** data-plane) `apps/control-plane/src/runtime/events-executor.mjs:17`: `evt.<workspaceId>.<topic>`
  — uses the **unique workspace id** (correctly non-crossable; comment: "the physical prefix is never crossable").

**Empirical proof (gateway JWT path):** acme-ops and globex-ops each `POST /v1/events/workspaces/{their app-staging}/topics {name:"collide-events"}`:
- acme → `resourceId=res_topic_80c2db4e`, `physicalTopicName=ws.app-staging.collide-events`
- globex → **identical** `resourceId=res_topic_80c2db4e`, **identical** `physicalTopicName=ws.app-staging.collide-events`
- Kafka broker: a **single** physical topic `ws.app-staging.collide-events` exists (shared), not two.

Root: both tenants seeded a workspace with slug `app-staging`; the store returns the existing record on the colliding
physical name. Consequences:
1. **Tenant lock-out (availability/correctness):** the *second* tenant (globex) silently receives the *first*
   tenant's topic record (tenant_id=acme); every subsequent globex call to it → **404** (id-scope guard). So with the
   default workspace slugs (`app-staging`/`app-prod`), only the FIRST tenant to provision a given topic name can use
   it; **all later tenants are locked out of that topic name**. Multi-tenant events provisioning is broken at scale.
2. **Shared physical channel (latent isolation risk):** both tenants map to one physical Kafka topic. The gateway JWT
   path blocks tenant B by id-scope today, but the shared topic is reachable by direct Kafka and is fragile to any
   physical-name code path.
3. **JWT/apiKey path inconsistency:** the same logical topic resolves to `ws.<slug>.<t>` (JWT) vs `evt.<wsId>.<t>`
   (apiKey) — events published via one path are invisible to the other (silent message loss).

**Proposed fix:** derive the control-plane physical name from the **unique workspace id** (align with the executor's
`evt.<workspaceId>.<topic>`), and key the topic store by (workspace_id, topic_name) — never the slug.
**Acceptance:** two same-slug workspaces across tenants get **distinct** physical topics + distinct resourceIds; the
second tenant can provision & use its topic; JWT and apiKey paths resolve to the same physical topic.

## Note on fixture artifact
The seeded `.fixtures.json` recorded the SAME `res_topic_873fb492` for both tenants' `app-staging-events` topics
for exactly this reason — the automated `run-tests.mjs` ISO-EVENTS check (which reused that shared id) reported a
false 200/202 "leak"; the real mechanism is the slug collision above, not an id-scope bypass.
