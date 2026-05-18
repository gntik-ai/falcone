# Capability M2 — Secret Audit Pipeline

**Source locus:** `services/secret-audit-handler/` — **194 LOC of `.mjs` across 5 files** + README + `package.json` + 4 tests.

| File | LOC | Role |
|---|---|---|
| `src/index.mjs` | 34 | Bootstrap: connect Kafka, tail log, sanitise, publish |
| `src/event-schema.mjs` | 49 | `FORBIDDEN_FIELDS`, `SecretAuditEvent` schema constant, `hasForbiddenField`, `validateAuditEvent` |
| `src/vault-log-reader.mjs` | 48 | `parseVaultEntry`, `createLogTailer` (async generator) |
| `src/kafka-publisher.mjs` | 38 | `createPublisher` factory |
| `src/sanitizer.mjs` | 25 | `sanitize` — recursive strip of forbidden keys |

Canonical contract: `internal-contracts/secrets/secret-audit-event-v1.yaml` (read at the bottom for cross-check).

**Method.** Read every source file end-to-end, the canonical YAML contract, and two test files. Did not consult `docs/`, `openspec/`, or `01-capability-map.md`.

**Headline finding up front:** **the log tailer doesn't tail.** `vault-log-reader.mjs:39-48` opens the file with `fs.createReadStream`, drains it via `readline`, calls `fs.watch(filePath, () => undefined)` (a no-op watcher that's never awaited), and then **returns from the generator**. The service consumes the existing log from the first line, publishes everything to Kafka, then idles forever — new lines written by Vault after startup are never read. Combined with the absence of any checkpoint/offset, every process restart **replays the entire historical log**, causing massive duplicate publication.

---

## SPEC (what exists)

### S1. Bootstrap and lifecycle

- **WHEN** the process starts, **THE SYSTEM SHALL** read env vars `VAULT_AUDIT_LOG_PATH` (default `/vault/audit/vault-audit.log`), `KAFKA_BROKERS` (comma-split), and `SECRET_AUDIT_KAFKA_TOPIC` (default `console.secrets.audit`) (`src/index.mjs:5-7`).
- **WHEN** `KAFKA_BROKERS` resolves to empty, **THE SYSTEM SHALL** log `'KAFKA_BROKERS is required'` to stderr and `process.exit(1)` (`src/index.mjs:9-12`).
- **WHEN** the publisher fails to connect, **THE SYSTEM SHALL** log to stderr and `process.exit(1)` (`src/index.mjs:16-21`).
- **WHEN** SIGTERM/SIGINT arrives, **THE SYSTEM SHALL** call `publisher.disconnect()` then `process.exit(0)` (`src/index.mjs:23-29`).
- **WHEN** the log tailer yields entries, **THE SYSTEM SHALL** sanitise each entry then call `publisher.publishAuditEvent(cleaned)` sequentially (`src/index.mjs:31-34`).

### S2. Vault entry parsing (`src/vault-log-reader.mjs`)

- **WHEN** `parseVaultEntry(line)` runs, **THE SYSTEM SHALL** `JSON.parse(line)`; strip the prefix `secret/data/` from `entry.request.path`; split the remainder by `/` taking the first segment as `domain` (default `'platform'` if path missing) and the last segment as `secretName` (default `'unknown'`) (`vault-log-reader.mjs:6-9`).
- **WHEN** auth metadata is extracted, **THE SYSTEM SHALL** read `auth.display_name` (default `'unknown'`), `auth.metadata.service_account_namespace` (default `'unknown'`), `auth.metadata.service_account_name` (default `display_name`) (`:10-12`).
- **WHEN** `entry.error` is truthy, **THE SYSTEM SHALL** classify `operation: 'denied'` and `result: 'denied'`; otherwise map `entry.request.operation` through `mapOperation`: `delete→delete, update|create→write, else→read` (`:13, :27, :33-37`).
- **WHEN** building the event, **THE SYSTEM SHALL** stamp `eventId` as `entry.request.id ?? randomUUID()`, `timestamp` as `entry.time ?? now`, `requestorIdentity.type` as `'user'` if namespace is the literal string `'unknown'` else `'service'`, `denialReason: entry.error ?? null`, `vaultRequestId: entry.request.id ?? randomUUID()` (`:14-30`).
- **WHEN** `createLogTailer(filePath)` is invoked, **THE SYSTEM SHALL** open a `fs.createReadStream(filePath, {encoding:'utf8'})`, drain via `readline` line-by-line, and yield `parseVaultEntry(line)` for each non-empty line (`:39-48`).

### S3. Sanitiser (`src/sanitizer.mjs`)

- **WHEN** `sanitize(entry)` runs, **THE SYSTEM SHALL** recursively walk arrays and objects, removing any key whose name (case-insensitive) exactly matches one of `FORBIDDEN_FIELDS = ['value', 'data', 'secret', 'password', 'token', 'key']` (`sanitizer.mjs:1-25`, `event-schema.mjs:1`).
- **WHEN** sanitisation is done, **THE SYSTEM SHALL** call `hasForbiddenField(cleaned)`; if any forbidden field survived, throw `'Forbidden field survived sanitization'` (`sanitizer.mjs:7-9`).
- **WHEN** the matcher is built, **THE SYSTEM SHALL** anchor it as `^(value|data|secret|password|token|key)$` (case-insensitive) (`sanitizer.mjs:3`).

### S4. Event schema validation (`src/event-schema.mjs`)

- **WHEN** the module is imported, **THE SYSTEM SHALL** expose `FORBIDDEN_FIELDS` (6 entries), `SecretAuditEvent` (a JSON-Schema-shaped JS constant declaring `additionalProperties: false`, 9 required fields, enums for `operation`/`domain`/`result`/`requestorIdentity.type`), and helpers `hasForbiddenField` + `validateAuditEvent` (`:1-49`).
- **WHEN** `validateAuditEvent(event)` runs, **THE SYSTEM SHALL** throw if `hasForbiddenField(event)` returns true; then iterate `SecretAuditEvent.required` and throw `Missing required field: ${name}` if any is absent; return `true` otherwise (`:39-48`).
- **WHEN** `hasForbiddenField(input)` recurses, **THE SYSTEM SHALL** flag a key whose `toLowerCase()` exactly matches any `FORBIDDEN_FIELDS` entry OR ends with `.${field}`; recurse into every value (`:30-37`).
- **WHEN** `validateAuditEvent` runs, **THE SYSTEM SHALL NOT** validate types, enums, formats, or `additionalProperties`. It checks only required-field presence and forbidden-field absence (`:39-48`).

### S5. Kafka publisher (`src/kafka-publisher.mjs`)

- **WHEN** `createPublisher({brokers, topic, producer?})` runs, **THE SYSTEM SHALL** construct a KafkaJS client (`logLevel: NOTHING`, retry 5 with 300ms initial backoff) and a producer, unless an `injectedProducer` is supplied for tests (`:4-10`).
- **WHEN** `publishAuditEvent(event)` runs, **THE SYSTEM SHALL** call `validateAuditEvent(event)` (throws on failure — surfaces to the bootstrap for-await), then send `{topic, messages: [{key: event.domain, value: JSON.stringify(event), headers: {eventId, domain}}]}` (`:16-29`).
- **WHEN** the Kafka send throws, **THE SYSTEM SHALL** `console.error('Failed to publish audit event', error)` and return without re-throwing (`:30-32`).

### S6. Canonical contract (`internal-contracts/secrets/secret-audit-event-v1.yaml`)

- **WHEN** an external consumer validates against the YAML, **THE SYSTEM SHALL** enforce: `additionalProperties: false`, the same 9-field required list, `not.anyOf: [{required:[value]}, {required:[data]}]` — only `value` and `data` are explicitly forbidden at the schema level.

---

## GAPS

### G-cross. Cross-cutting

1. **The log tailer is not a tailer.** See B1.
2. **No checkpoint / offset persistence.** Process restart re-publishes the entire historical log.
3. **No backpressure signal.** Sequential `await publishAuditEvent` inside the for-await loop; if Kafka is slow, the handler simply lags behind without ever surfacing it.
4. **Topic-naming convention `console.secrets.audit` doesn't match the M1 canonical pipeline contract** (`audit.<tenant_id>` / `audit.platform`). The Kafka message key is `event.domain` (one of 5 operational domains), not a tenant id — so partitioning is by operational area, not by tenant.
5. **The canonical YAML and the JS schema constant disagree on forbidden-field policy.** YAML's `not.anyOf` lists only `value` and `data`. The JS `FORBIDDEN_FIELDS` lists 6 (`value, data, secret, password, token, key`). Two sources of truth for the same constraint.
6. **`validateAuditEvent` is a hand-rolled subset validator** (required-fields + forbidden-fields). The JSON-Schema-shaped constant at `event-schema.mjs:3-28` declares enums, formats, and `additionalProperties: false` — **none of which is enforced at runtime**. AJV is not declared in `package.json` (only `kafkajs`).
7. **Package's `test` script glob** uses `tests/**/*.test.mjs` (`package.json:10`), which only expands recursively if the shell has globstar enabled. Same caveat as D2.
8. **Single point of failure on parse error.** `parseVaultEntry` throws on bad JSON; the for-await loop in `index.mjs` doesn't catch. One malformed line crashes the whole process.
9. **Kafka send failures are swallowed.** Logged to stderr only; no DLQ, no metric, no retry-with-backoff beyond KafkaJS's built-in retry config. Lost audit events are invisible.
10. **`SECRET_AUDIT_KAFKA_TOPIC` default `'console.secrets.audit'` is yet another topic-naming convention.** Per M1 audit, the repo has 5+ inconsistent audit topic conventions.

### G-S2. Parser

- **G-S2.1** Default `domain = 'platform'` is applied via destructuring default in `[domain = 'platform', ...rest] = path.split('/')`. If `path.split('/')` returns at least one element, `domain` takes that first element — which can be anything. The destructuring default only fires for an empty array, which `split('/')` never returns. Misleading default.
- **G-S2.2** When `path` lacks the `secret/data/` prefix, the result is `'unknown/unknown'` and `domain` becomes `'unknown'` — not in the canonical enum `['platform','tenant','functions','gateway','iam']`. See B5.
- **G-S2.3** `requestorIdentity.type` derived from `namespace === 'unknown' ? 'user' : 'service'`. A real namespace literally named `'unknown'` is misclassified as a user.
- **G-S2.4** `eventId` and `vaultRequestId` both default to `randomUUID()` when `entry.request.id` is missing — and they're computed independently (`:15, :29`), so the two fields may carry different UUIDs even when both stand in for the missing Vault id. Audit linkage broken.
- **G-S2.5** `parseVaultEntry` does no schema validation against the actual Vault audit format. Vault has a richer schema (auth.token info, request.namespace, response, etc.) — the parser silently ignores everything except a handful of fields.
- **G-S2.6** `mapOperation(entry?.request?.operation)` defaults to `'read'` for any unknown operation. New Vault operations (e.g., `list`, `patch`) are silently labelled `'read'`.

### G-S3. Sanitiser

- **G-S3.1** `forbiddenMatcher` (`sanitizer.mjs:3`) anchors exact key match. Hyphenated or prefixed keys (`'secret_value'`, `'api_key'`, `'access-token'`) are not stripped. The L1 audit (B5.4) and the M1 audit both flagged the same incomplete-blacklist pattern as a class-wide issue.
- **G-S3.2** Sanitiser recurses arrays (`Array.isArray(value) → map`), so nested objects in array elements are descended. OK.
- **G-S3.3** No max-depth guard. Pathological deeply-nested objects could cause stack overflow.

### G-S4. Schema validation

- **G-S4.1** `validateAuditEvent` checks only presence + forbidden-fields. **Enum values for `operation`, `domain`, `result`, `requestorIdentity.type` are not enforced.** An event with `domain: 'unknown'` (from the parser default), `operation: 'unknown_op'`, or `result: 'maybe'` passes validation.
- **G-S4.2** `additionalProperties: false` declared in `SecretAuditEvent` but **never enforced**. A producer (or a future bug in the parser) could add stray fields.
- **G-S4.3** `hasForbiddenField` "endsWith `.${field}`" branch (`:34`) is effectively dead code. JS object keys produced by `Object.entries` rarely contain dots. The branch protects against a use case that doesn't arise from normal JSON parsing.
- **G-S4.4** `SecretAuditEvent.required` (`:5`) lists 9 fields but omits `denialReason`. The contract YAML similarly marks `denialReason` as optional (nullable). OK by design but worth noting.

### G-S5. Publisher

- **G-S5.1** `logLevel: NOTHING` (`kafka-publisher.mjs:7`) suppresses all KafkaJS internal logs. Diagnostic gap — broker errors, broker switches, retries, all silent.
- **G-S5.2** Kafka send error swallowed with bare `console.error` (`:31`). No structured logging, no metric, no notion of a poison-message DLQ.
- **G-S5.3** No `idempotent: true` on producer creation. Combined with KafkaJS's retry policy (5 retries), duplicate publishes may occur on transient failures.
- **G-S5.4** Producer connect happens once in `index.mjs:17`. No reconnect logic if Kafka goes away mid-stream. After a long Kafka outage the publisher's underlying connection may be stale; KafkaJS handles some of this internally but not all.
- **G-S5.5** Message `key: event.domain` — partitions by operational domain (5 values), so all secrets across all tenants land in one of 5 partitions. Tenant isolation absent.
- **G-S5.6** Headers `{eventId, domain}` — useful for consumer dedup, but only if consumers actually consult them (they may not, since they appear as Kafka headers, not as part of the JSON body which already includes the same fields).

### G-tests

- **G-T1** Unit tests for sanitiser, parser, publisher, and an integration test. Coverage of the tailer's tail-behaviour (B1) is absent — the unit tests use literal strings, not running file IO.
- **G-T2** No test asserts that a malformed log line skips rather than crashes (B6).
- **G-T3** No test asserts that the publisher emits to the expected topic with the expected key/headers — they pass an `injectedProducer` (per `:4`) and assert the recorded send.
- **G-T4** No test asserts schema enums are enforced (because they aren't — see G-S4.1).

---

## BUGS

### Confirmed (verified-by-author from cited lines)

- **B1. The log tailer doesn't tail — `fs.watch` is a no-op and the generator returns at EOF.**
  `services/secret-audit-handler/src/vault-log-reader.mjs:39-48` (verified-by-author):
  ```js
  export async function* createLogTailer(filePath) {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (line.trim()) yield parseVaultEntry(line);
    }
    fs.watch(filePath, () => undefined);  // ← fire-and-forget; no-op callback
  }
  ```
  `fs.createReadStream` reads to EOF and ends. The `for await` exits. `fs.watch` is called but its handler does nothing. The generator function then returns. **No new lines are ever read.** Combined with the consumer `for await` in `index.mjs:31-34`, the process becomes idle and never processes another Vault audit event.

- **B2. First-run and every-restart floods Kafka with the entire historical log.**
  Same `vault-log-reader.mjs:39-48` (verified-by-author) — `fs.createReadStream` starts at byte 0 with no offset checkpoint. The publisher loop calls `publishAuditEvent` per line from line 1 onward. On every process restart, the entire Vault audit log is re-published. Consumers downstream of `console.secrets.audit` see massive duplication.

- **B3. `parseVaultEntry` throws on malformed JSON; the bootstrap loop doesn't catch.**
  `vault-log-reader.mjs:6` (verified-by-author) — `JSON.parse(line)` with no try/catch. `index.mjs:31-34` (verified-by-author) has no try/catch around the for-await. **A single malformed line crashes the entire process.** Combined with B2, the crash-restart-replay cycle on a single bad line produces unbounded replays.

- **B4. `validateAuditEvent` doesn't validate enums, types, formats, or `additionalProperties`.**
  `event-schema.mjs:39-48` (verified-by-author) — only checks `hasForbiddenField` and `required` field presence. The schema constant at `:3-28` declares enums for `operation`, `domain`, `result`, `requestorIdentity.type`, format `uuid`/`date-time` constraints, and `additionalProperties: false` — none of which is enforced. AJV is not declared in `package.json`. **An event with `domain: 'unknown'`, `operation: 'banana'`, `result: 'maybe'` passes validation.**

- **B5. `parseVaultEntry` produces `domain` values outside the schema enum.**
  `vault-log-reader.mjs:7-8` (verified-by-author). When `entry.request.path` lacks the `secret/data/` prefix, the result `'unknown/unknown'`'s first segment becomes `'unknown'`. This is not in the enum `['platform','tenant','functions','gateway','iam']`. Combined with B4, the malformed event is published silently. Audit consumers expecting the enum see an unexpected value.

- **B6. The forbidden-field matcher is exact-key only.**
  `sanitizer.mjs:3` (verified-by-author) — `new RegExp('^(value|data|secret|password|token|key)$', 'i')`. **Hyphenated, prefixed, or suffixed keys are not stripped:** `secret_value`, `api_key`, `access-token`, `client_secret`, `auth_token`. Vault audit entries do contain such variants in practice (Vault writes `request.data.password` under `data`, but also `auth.token_policies` and others). The sanitiser misses them. The L1 audit's B5.4 found the same blacklist incompleteness in `storage-audit-ops.mjs`; the pattern repeats here.

- **B7. The canonical YAML and the JS schema disagree on forbidden-field policy.**
  `internal-contracts/secrets/secret-audit-event-v1.yaml` (read at the bottom of inventory) declares `not.anyOf: [{required:[value]},{required:[data]}]` — only `value` and `data` are forbidden by the YAML. The JS `FORBIDDEN_FIELDS` (`event-schema.mjs:1`) lists 6 (`value, data, secret, password, token, key`). External consumers validating against the YAML accept events with `secret/password/token/key` keys; the runtime sanitiser strips them. **Two sources of truth, both incomplete in different ways.**

- **B8. Kafka send errors are swallowed.**
  `kafka-publisher.mjs:30-32` (verified-by-author) — `try { producer.send(...) } catch (error) { console.error(...) }`. No retry, no DLQ, no error metric. KafkaJS has internal retry (5 retries per `:8`) but once exhausted, the error reaches the catch, is logged, and the next event proceeds. **Lost audit events are invisible.**

- **B9. Topic-naming convention `console.secrets.audit` doesn't match the M1 canonical pipeline.**
  Default at `index.mjs:7` (verified-by-author). M1's `observability-audit-pipeline.json` declares `audit.<tenant_id>` and `audit.platform`. M2 ignores this and also adds yet another convention (`console.secrets.*`) on top of D1's `console.audit.gateway`, F3's `console.webhook.*`, K1's `console.audit`, L1's `platform.audit.events`, H1's `mongo.admin`. **6+ conventions across the repo.**

- **B10. Partitioning key is the operational domain, not the tenant.**
  `kafka-publisher.mjs:22` (verified-by-author): `key: event.domain`. Only 5 domain values exist. All events for a domain land in one partition; tenant isolation is not preserved at the transport layer. Per M1's canonical pipeline contract, partitioning should be by `tenant_id` — but this stream has no `tenant_id` at all in its schema (only `domain`).

- **B11. `requestorIdentity.type` misclassifies real namespaces named `'unknown'`.**
  `vault-log-reader.mjs:22` (verified-by-author): `type: namespace === 'unknown' ? 'user' : 'service'`. If the Vault auth metadata's `service_account_namespace` is literally the string `'unknown'` (because a service account is misconfigured), the event is classified as a `'user'` action. The logic conflates "namespace is the literal word 'unknown'" with "no namespace was supplied".

- **B12. `eventId` and `vaultRequestId` may carry different UUIDs.**
  `vault-log-reader.mjs:15, :29` (verified-by-author) — both compute `entry?.request?.id ?? randomUUID()` independently. When the Vault id is missing, two distinct `randomUUID()` calls return different values. The fields are then conceptually unlinked. The fix is `const vaultId = entry?.request?.id ?? randomUUID()` then reuse it twice.

### Likely

- **B13. `mapOperation` default to `'read'` for unknown operations.** `vault-log-reader.mjs:33-37` (verified-by-author). New Vault operation types (e.g., `'list'`, `'patch'`, `'rollback'`) are silently labelled `'read'`. Audit consumers see a read where there was a write.

- **B14. `hasForbiddenField` `.endsWith('.${field}')` branch is dead.** `event-schema.mjs:34` (verified-by-author). JS object keys from JSON.parse don't contain dots.

- **B15. KafkaJS `logLevel: NOTHING` suppresses all internal diagnostics.** `kafka-publisher.mjs:7` (verified-by-author). Broker switches, connection resets, retries — all invisible.

- **B16. No `idempotent: true` on producer.** `kafka-publisher.mjs:10`. KafkaJS retries (5x) without idempotency may publish duplicates.

- **B17. Sequential await — no concurrency.** `index.mjs:31-34` awaits each publish. A slow Kafka makes the handler fall behind without surfacing back-pressure. (Mostly moot per B1.)

- **B18. Process exit on Kafka connect failure is the right call but the disconnect rejection on SIGTERM is ignored.** `index.mjs:23-25` — `shutdown` awaits `publisher.disconnect()` and then exits 0 regardless of rejection.

- **B19. `parseVaultEntry` does no max-line-size check.** `vault-log-reader.mjs:6` — `JSON.parse(line)` accepts any size. A multi-MB malformed line could OOM.

- **B20. `sanitiser` has no max-depth guard.** Pathological nested objects cause stack overflow in the recursive `stripForbidden`.

### Needs verification

- **B21. Whether Vault is actually configured to write its audit log in JSON-per-line format at the path `/vault/audit/vault-audit.log`.** If Vault uses a different format (raw socket, multi-line), the parser fails on every line.
- **B22. Whether the chart's Helm template mounts the Vault audit volume read-only as the README suggests.** Outside this audit's scope.
- **B23. Whether downstream consumers of `console.secrets.audit` reconcile event IDs (B12 produces two UUIDs that should be one).**
- **B24. Whether any consumer expects the canonical envelope from M1 (it doesn't — this event is the flat shape declared in `event-schema.mjs:3-28`, divergent from M1's `actor/scope/resource/action/result/origin` envelope).**

---

## Scope note for downstream spec authoring

M2 is a small, focused service whose single intent — "tail Vault audit log, sanitise, publish to Kafka" — is contradicted by the tailer's actual behaviour. Five must-fix items before any spec proposal:

1. **B1 (tailer doesn't tail).** Replace `fs.watch(...) → undefined; return` with a proper tail loop (e.g., `chokidar` or a periodic poll-and-seek using the file's last position). The current code reads to EOF once and idles.
2. **B2 (no checkpoint).** Persist the last-published Vault `request.id` or byte-offset so restarts don't replay the entire log. Without this, B1's fix is dangerous — the first proper tail run will replay everything from byte 0.
3. **B3 (parse-error crashes process).** Wrap `parseVaultEntry` in try/catch at the for-await level; route malformed lines to a metric counter or a DLQ.
4. **B4 (validator is incomplete).** Wire AJV against either `SecretAuditEvent` or the YAML contract. Today's "validation" only catches forbidden fields and missing required fields; enum and format violations slip through.
5. **B6 / B7 (forbidden-field policy fragmentation).** Pick one source of truth (the YAML or the JS constant), expand the list to cover the obvious variants (`secret_value`, `api_key`, `access_token`, `client_secret`), and update both consumers.

Secondary cleanup: B5 (`domain='unknown'` from parser), B8 (Kafka error swallow), B9 (topic-name convention), B10 (partition by operational domain — should be by tenant), B11 (literal-`'unknown'` namespace classification), B12 (independent UUIDs), B13 (unknown-op default), B15 (KafkaJS log suppression), B19/B20 (no DoS guards).

Once these land, M2 becomes a clean candidate for OpenSpec FR formalisation — but until the tailer actually tails, the service's stated purpose isn't met.
