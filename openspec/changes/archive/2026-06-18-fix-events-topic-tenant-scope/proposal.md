# fix-events-topic-tenant-scope

## Change type
bugfix

## Capability
events

## Priority
P0

## Why
A valid tenant-A JWT can read, publish to, and SSE-consume tenant-B's Kafka topics.

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** As `acme-ops`: `GET /v1/events/topics/{globexTopicId}`→200; `POST .../{globexTopicId}/publish`→202 (event injected into B's topic); `GET .../{globexTopicId}/stream`→returns B's events. Symmetric B→A. Root: `kafka-handlers.mjs::getTopicByResourceId` resolves by id with no tenant predicate.

GitHub issue #547 (epic #539). Evidence: `audit/live-campaign/evidence/23-events-functions.md`.

## What Changes
Scope every topic-id route by the caller's verified `tenant_id` (resolve topic→workspace→tenant, 403/404 on mismatch), mirroring the executor's workspace-ownership guard, in both `deploy/kind/control-plane/kafka-handlers.mjs` and the product events handler.

## Impact
Cross-tenant topic detail/metadata/publish/stream → 403/404; same-tenant unaffected; covered by a black-box + live 2-tenant probe.
