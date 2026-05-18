## Context

The audit established that `services/adapters/src/` is six "pure compiler/
validator" modules: each builds an envelope describing the work to be done,
and each exports stub entry points (`createTopicNamespace`, `createRealm`,
`createClient`, `assignRole`, `createServiceAccount`,
`updateServiceAccountScopeBindings`, `regenerateServiceAccountCredentials`,
`disableServiceAccount`, `deleteServiceAccount`, `generateClientCredential`,
`rotateClientCredential`, `revokeClientCredential`) for the work itself.
Every stub throws `NOT_YET_IMPLEMENTED`. **No provider client is opened
anywhere in `services/adapters/src/`.** The execution glue is the missing
strategic deliverable.

This proposal covers Kafka and Keycloak only. The other four providers
(PostgreSQL, MongoDB, OpenWhisk, storage) are tracked in their respective
capability proposals.

## Goals

- 12 executor entry points become real provider calls (1 Kafka + 11
  Keycloak).
- The split between "pure compiler" (in `services/adapters/src/`) and "runtime
  executor" (in `services/adapters/src/runtime/`) is preserved so the
  compiler layer remains synchronously testable.
- Executors emit the audit event already declared in the compiler layer; no
  silent successes.

## Non-goals

- Storage adapter executors (covered by a follow-up under G1).
- Refactoring the compiler-validator layer (already audited as well-formed).
- Implementing a generic adapter SDK or `runtime/` framework — each provider
  client stays explicit; shared retry/timeout helpers are minimal.

## Decisions

### Decision 1: Provider client placement

The runtime executors live in `services/adapters/src/runtime/` (one file per
provider). The `services/adapters/src/<provider>-admin.mjs` files re-export
the executor functions from `runtime/<provider>-client.mjs`, replacing the
`throw new Error('NOT_YET_IMPLEMENTED')` body with the runtime call. This
keeps the audit-friendly file structure intact and isolates the
provider-client dependency.

### Decision 2: Kafka client choice

Use KafkaJS (already implied by the audit's reference to "KafkaJS Kafka"
adapter shape at S4). Pin to the latest 2.x. Configure with SASL+SSL by
default; allow PLAINTEXT only when `NODE_ENV=test`.

### Decision 3: Keycloak admin REST

Use the Keycloak admin REST API via the official `@keycloak/keycloak-admin-client`
SDK (or a tiny vendored client if the SDK pulls heavy dependencies). The
client MUST authenticate via a dedicated `services/keycloak-config/` admin
service-account whose credential rotates per the secret-management runbook.

### Decision 4: Error mapping

Each executor wraps provider exceptions and maps to the `ERROR_CODE_MAP`
already declared at `kafka-admin.mjs:867-894` and
`keycloak-admin.mjs:91-101, :265`. Unmapped exceptions become
`EVT_KAFKA_DEPENDENCY_FAILURE` / `GW_IAM_DEPENDENCY_FAILURE`.

### Decision 5: Retries and timeouts

- Kafka: 3 retries with exponential backoff on `RETRIABLE` errors
  (KafkaJS classifies); 5 s per-call timeout; no retry on `UNKNOWN`.
- Keycloak: 2 retries with linear backoff (250 ms, 500 ms) on 5xx; no retry
  on 4xx; 10 s per-call timeout.

### Decision 6: Audit emission

Reuse the audit envelope already built by the compiler layer
(`kafka.admin.reconciled` already exists at Kafka `:630-673`; introduce a
matching `iam.admin.reconciled` event in the Keycloak runtime). Emission
uses the same Kafka producer the audit pipeline uses (per M2).

## Risks / Trade-offs

- The runtime clients add operational dependencies (KafkaJS, Keycloak admin
  SDK). Mitigated by isolating the dependency in `runtime/`.
- KafkaJS-vs-real-cluster behaviour drift: integration tests against an
  in-process Kafka harness mitigate but cannot fully eliminate.
- Keycloak admin SDK pulls in a lot of code; if size matters, a tiny
  vendored client (fetch + endpoint map) is acceptable.

## Migration plan

1. Ship the two runtime modules behind a feature flag
   `ADAPTER_EXECUTORS_ENABLED=false`. The stubs continue to throw.
2. In test environments, flip the flag and exercise via per-provider
   integration tests.
3. Pre-prod canary: enable executors for non-production realms /
   non-production topics.
4. Production cutover: per-provider; document rollback as `flag = false +
   re-throw stub`.
