## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add a test in
      `services/provisioning-orchestrator/tests/workspace-capability-catalog-correlation.test.mjs`
      that issues two requests for the same workspace without an
      `x-correlation-id` header; assert the synthesised correlation ids
      differ (proves B2 at
      `workspace-capability-catalog.mjs:66` and G13).
- [ ] 1.2 [test] Add a test that issues one request with header
      `X-Correlation-Id: abc-123` and asserts the resolved correlation id
      is `abc-123` (proves B12 — case-sensitive lookup at `:66`).
- [ ] 1.3 [test] Add a test that forces the audit emitter to reject for
      every call; assert the request still returns 200 AND that the
      undelivered event lands in the DLQ (proves B11 at `:70-72`).

## 2. Implementation

- [ ] 2.1 [fix] Replace the
      ```corr-${workspaceId}``` fallback at
      `services/provisioning-orchestrator/src/actions/workspace-capability-catalog.mjs:66`
      with a per-request UUID (or ULID); each call MUST produce a unique
      correlation id when no header is supplied.
- [ ] 2.2 [fix] Normalise the header lookup at `:66` to be
      case-insensitive: iterate the `params.headers` keys with
      `.toLowerCase() === 'x-correlation-id'`, or pre-lowercase the
      headers map before reading.
- [ ] 2.3 [fix] Replace the fire-and-forget `.catch(warn)` at `:70-72`
      with a durable path: await the publish and on failure write the
      event to an audit DLQ before returning 200. A persistent broker
      outage MUST NOT silently drop the event.
- [ ] 2.4 [migration] If the DLQ strategy requires a new table, add the
      migration alongside this change; otherwise document the reuse of
      the existing shared audit DLQ.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the per-request correlation-id contract,
      the case-insensitive header lookup, and the audit DLQ behaviour
      in `services/provisioning-orchestrator/src/README.md`.
- [ ] 3.2 [test] Run targeted tests plus
      `openspec validate harden-c2-correlation-and-audit --strict`; both
      green before merge.
