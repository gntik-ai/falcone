## Context

`services/adapters/src/kafka-admin.mjs::buildKafkaAdminAdapterCall` produces topic-admin
and ACL policy objects for admin operations. No code anywhere in the control-plane ever
passed produce/consume intent to a Kafka driver. The four events HTTP routes in
`apps/control-plane/src/runtime/server.mjs` existed (the `evt` pattern and `runEvents`
helper) but `eventsExecutor` was never instantiated, causing every call to return 501.

Unlike the Postgres and MongoDB executors — where the adapter builds a driver-ready plan
that the executor runs — the Kafka adapter builds only admin policy. There is no
`buildKafkaPlan` for produce/consume. The executor therefore drives `kafkajs` directly,
following the same direct-driver pattern used by the kind control-plane's
`kafka-handlers.mjs`.

The kind runtime's per-workspace topic prefix (`evt.<workspaceId>.<topic>`) is the
established isolation model in this codebase; the executor reuses it.

## Goals / Non-Goals

**Goals:**
- Implement `createEventsExecutor({brokers})` + `executeEvents(params)` in
  `apps/control-plane/src/runtime/events-executor.mjs`.
- Support operations: `create_topic`, `list_topics`, `publish`, `consume` (poll-based).
- Tenant isolation via per-workspace physical-topic prefix: `evt.<workspaceId>.<topic>`.
  `list_topics` strips the prefix and returns logical names only — the physical prefix
  is never exposed to the caller.
- Wire the executor into `server.mjs` via the existing `runEvents` helper; instantiate
  from `main.mjs` when `KAFKA_BROKERS` is set.
- Prove correctness with `tests/env/executor/events-executor.test.mjs` (real Redpanda).

**Non-Goals:**
- SSE or WebSocket streaming for real-time consume (deferred).
- Consumer group management and offset commit (deferred).
- Topic ACL management through the executor (admin policy path remains separate).
- Schema registry integration (deferred).
- Multi-broker TLS/SASL configuration beyond `KAFKA_BROKERS` (deferred).

## Decisions

**D1 — Direct driver (kafkajs); no adapter plan for produce/consume.**
The Kafka adapter builds only admin/ACL policy (`buildKafkaAdminAdapterCall`). There is
no plan type for produce/consume in the adapter contract. Adding one would require
designing a new plan schema with no existing consumer. The executor drives `kafkajs`
directly, which is consistent with the kind runtime's approach and keeps the adapter
boundary clean: adapter = policy/schema validation; executor = I/O.

**D2 — Structural tenant isolation via per-workspace physical-topic prefix.**
`evt.<workspaceId>.<topic>` is the established isolation model (kind runtime). A
workspace that tries to publish to or consume from another workspace's stream would need
to forge the `workspaceId` in the path, which is rejected before the Kafka call because
the identity's `workspaceId` is taken from verified gateway-injected headers. There is
no Kafka ACL enforced at this layer; isolation is structural.

**D3 — Lazy-connected singleton producer and admin; ephemeral consumer per consume call.**
The producer and admin client are connected on first use and reused across requests.
A new consumer is created per `consume` call with a random group ID so that each poll
starts from the beginning and does not interfere with other consumers or persist offsets.
This is intentional for the initial poll-based consume model.

**D4 — Broker failures surface as HTTP 502 (`KAFKA_ERROR`).**
Any `kafkajs` error that does not carry a `statusCode` is caught, logged server-side,
and re-thrown as `{statusCode: 502, code: "KAFKA_ERROR"}` without exposing the raw
broker message to the caller. This is consistent with the Mongo executor's 500-mapping
policy but uses 502 because the failure is in an upstream broker, not in the control
plane itself.

**D5 — 501 when no executor is configured (`EVENTS_DISABLED`).**
`runEvents` in `server.mjs` returns 501 `EVENTS_DISABLED` when `eventsExecutor` is
falsy. Deployments without a Kafka broker fail fast rather than silently.

## Risks / Trade-offs

**Risk: The lazy producer is not closed on unhandled process exit.**
Mitigation: `main.mjs` calls `eventsExecutor.close()` in the SIGTERM/SIGINT handler;
graceful exit is covered. Crash exit may leak the connection; acceptable at this phase.

**Risk: Poll-based consume with a fresh consumer group per call is inefficient for
large topics.**
Mitigation: The initial use case (control-plane inspector, CI test probing) does not
require high-throughput streaming. SSE/WebSocket streaming is explicitly deferred.

**Risk: `list_topics` returns all topics on the broker filtered by prefix; on a shared
cluster with many workspaces this could be slow.**
Mitigation: `kafkajs` `listTopics()` returns a flat string array; the prefix filter is
an in-process `Array.filter`. Acceptable at current scale; pagination is deferred.
