## Why

`services/event-gateway/src/runtime.mjs::validateEventPublicationRequest:386-468` is the central validation gate for every event publication. It receives both `context` (authenticated caller's resolved identity) and `topic` (pre-resolved topic object) as named parameters, yet it never asserts `topic.tenantId === context.tenantId` or `topic.workspaceId === context.workspaceId`. `services/event-gateway/src/runtime.mjs::normalizePublicationInput:184-201` produces `normalized` from the raw request, where both `normalized.tenantId` (line 189) and `normalized.workspaceId` (line 190) are caller-controlled; the presence check at lines 391-395 is not an equivalence check against the authenticated context. `services/event-gateway/src/kafka-integrations.mjs::normalizeTopicRef:95-96` prefers the caller-supplied `topicRef` over the context value, so a caller can supply a `topicRef` owned by another tenant and the gateway will resolve and use it without protest. The deny pattern that should be applied is already established in the codebase: `apps/control-plane/src/observability-audit-export.mjs:107`, `observability-audit-correlation.mjs:42`, and `workflows/job-status.mjs:138` all implement `if (context.tenantId && tenantId !== context.tenantId) { invariant(false, ..., SCOPE_VIOLATION); }`. The `authorization_error` → HTTP 403 / `EVT_GATEWAY_FORBIDDEN` mapping already exists at `services/event-gateway/src/runtime.mjs:112` (bug-012 / iso-008).

## What Changes

- `validateEventPublicationRequest` SHALL assert `topic.tenantId === context.tenantId` and `topic.workspaceId === context.workspaceId`; on mismatch it MUST return `authorization_error` → HTTP 403 / `EVT_GATEWAY_FORBIDDEN`.
- `validateEventPublicationRequest` SHALL assert `normalized.tenantId === context.tenantId` and `normalized.workspaceId === context.workspaceId`; request-supplied identity fields are treated as untrusted until validated against authenticated context.
- The publication handler (call site) SHOULD derive tenant and workspace scope from the authenticated context rather than accepting them from request fields.
- Mirror the established deny idiom from `observability-audit-export.mjs:107` and siblings.

## Capabilities

### New Capabilities

- `events`: Tenant-scoped event publication validation, ensuring that a caller can only publish events to topics owned by their authenticated tenant and workspace, and that caller-supplied identity fields cannot override the authenticated context.

### Modified Capabilities

<!-- none: openspec/specs/ is empty; this introduces the events capability spec -->

## Impact

- `services/event-gateway/src/runtime.mjs::validateEventPublicationRequest:386-468` — add topic-vs-context and normalized-vs-context tenant/workspace assertions.
- `services/event-gateway/src/kafka-integrations.mjs::normalizeTopicRef:95-96` — SHOULD derive topic ref from authenticated context rather than preferring caller-supplied value.
- Publication requests with mismatched tenant/workspace now receive HTTP 403 `EVT_GATEWAY_FORBIDDEN` where they previously proceeded.
- Black-box suite: new cross-tenant publish rejection test `bbx-events-cross-tenant-publish-*`.
