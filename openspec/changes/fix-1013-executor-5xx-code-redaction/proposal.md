# Redact unclassified executor error codes

## Why

The executor hides 5xx messages but currently echoes raw driver/library error codes. An unhandled Postgres SQLSTATE or Node errno therefore becomes a public API code, despite having no platform classification.

## What changes

- Add `publicErrorCode(error, fallback)` in `apps/control-plane-executor/src/runtime/errors.mjs`. Preserve a code only when `statusCode` is an integer and the code is a string matching `/^[A-Z][A-Z0-9_]*$/`; otherwise use the handler's existing platform fallback. Classify by this rule, without a SQLSTATE or errno denylist.
- Apply the helper to the central JSON catch (`CONTROL_PLANE_ERROR`), flow-monitoring pre-stream JSON and catch-generated SSE error event (`FLOW_MONITORING_ERROR`), and LLM pre-stream JSON (`LLM_PROVIDER_ERROR`). Pass the existing logger into SSE route context and log the original error for 5xx in the two streaming handlers as well as the central handler.
- Preserve platform constructors and Postgres mappings. Keep 5xx messages generic and diagnostics, causes, SQL, errors arrays and dimensions out of those bodies. Preserve classified 4xx codes, messages, validation errors and quota dimensions.
- Add unit classification coverage and HTTP regressions for raw codes, classified platform failures, client envelopes, flow SSE errors and original-error logging.

## Limits and verification

The structural rule intentionally permits a third-party error with both an integer status and an upper-snake code. In particular, `statusCode: 500` plus `ECONNRESET` passes through under the mandatory predicate; the acceptance example grouping it with digit-leading `57P01` conflicts with that predicate. Follow the explicit classification constraint and document this edge rather than introducing an errno denylist. An unclassified `ECONNRESET` without a status falls back normally.

Keep this change limited to the shared helper, the three specified catch sites, their logger context, tests and this OpenSpec folder. Contract code-pattern drift, status mappings, role provisioning, late LLM stream errors and gateway routing remain separate work. No Helm, migration, dependency or workflow pin change is needed.

Run bounded local tests and record unavailable checks in tasks.md. PR CI must run the socket-based executor regressions after installing existing dependencies. Live reproduction of the API-key row failure and inspection of the original executor log require runtime access; any role-provisioning defect needs a separate issue without tenant or credential evidence.

## Rollout and rollback

An executor image rebuild delivers this source change through the existing release gates. Deployment execution remains operator-gated. Roll back by reverting this ChangeSet; no data recovery or chart changes are required.
